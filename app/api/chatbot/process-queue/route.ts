/**
 * app/api/chatbot/process-queue/route.ts
 *
 * Cron: processa jobs pendentes da chatbot_queue.
 * Chamado a cada minuto pelo Vercel Cron.
 *
 * Fluxo por job:
 *   1. Claim atômico (status pending → processing)
 *   2. Verifica bot_active (fresh) + handover timeout configurável
 *   3. Chama processInboundMessage
 *   4. Marca done ou failed
 *   5. Limpa jobs > 24h
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundMessage } from "@/lib/chatbot/processMessage";
import { interleaveQueueJobsByCompany } from "@/lib/chatbot/interleaveQueueJobsByCompany";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;
const INBOUND_COALESCE_WINDOW_SECONDS = getPositiveIntEnv("INBOUND_DEDUP_WINDOW_SECONDS", 20);
/** Em produção nunca usar claim best-effort: duplo processamento entre instâncias. */
const ALLOW_CLAIM_FALLBACK = process.env.NODE_ENV !== "production";

const REACTIVATE_MSG =
    "😔 No momento não há atendentes disponíveis.\n" +
    "Mas não se preocupe — nosso assistente automático está de volta para te ajudar!\n\n" +
    "Digite qualquer mensagem para continuar seu pedido.";

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader);
    if (authError) return authError;

    const admin = createAdminClient();
    const t0 = Date.now();

    // ── 1. Claim jobs atomicamente via RPC ────────────────────────────────────
    // Atomic: UPDATE ... WHERE status='pending' AND attempts < MAX_ATTEMPTS
    //         RETURNING id — apenas o que este cron vai processar
    const { data: claimed, error: claimErr } = await admin.rpc(
        "claim_chatbot_queue_jobs",
        { batch_size: BATCH_SIZE, max_attempts: MAX_ATTEMPTS }
    );

    if (claimErr) {
        return handleClaimError(admin, t0, claimErr);
    }

    const jobIds: string[] = (claimed ?? []).map((r: any) => r.id);
    if (!jobIds.length) {
        await cleanupOldJobs(admin);
        await emitQueueMetrics({ processed: 0, failed: 0, coalesced: 0 });
        return NextResponse.json({ ok: true, processed: 0, ms: Date.now() - t0 });
    }

    // Busca detalhes dos jobs claimados
    const { data: jobs } = await admin
        .from("chatbot_queue")
        .select("*")
        .in("id", jobIds);

    const jobList = interleaveQueueJobsByCompany(jobs ?? []);

    let processed = 0;
    let failed = 0;
    let coalesced = 0;
    const seenInBatch = new Set<string>();

    for (const job of jobList) {
        try {
            const coalesceKey = buildCoalesceKey(
                job.thread_id,
                job.phone_e164,
                job.company_id,
                job.body_text,
                job.metadata?.message_type ?? null
            );
            const shouldCoalesce =
                coalesceKey &&
                (
                    seenInBatch.has(coalesceKey) ||
                    await hasRecentEquivalentProcessed(admin, job, coalesceKey)
                );

            if (shouldCoalesce) {
                console.info("[process-queue] inbound coalesced", {
                    companyId: job.company_id,
                    threadId: job.thread_id,
                    messageId: job.message_id,
                    body: String(job.body_text ?? "").slice(0, 64),
                    messageType: job.metadata?.message_type ?? null,
                });
                await admin
                    .from("chatbot_queue")
                    .update({
                        status: "done",
                        last_error: "coalesced_duplicate_inbound",
                    })
                    .eq("id", job.id);
                processed++;
                coalesced++;
                continue;
            }

            if (coalesceKey) seenInBatch.add(coalesceKey);
            await processJob(admin, job);
            await admin
                .from("chatbot_queue")
                .update({ status: "done" })
                .eq("id", job.id);
            processed++;
        } catch (err: any) {
            console.error("[process-queue] job falhou:", job.id, err?.message);
            const attempts = (job.attempts ?? 0) + 1;
            await admin
                .from("chatbot_queue")
                .update({
                    status:     attempts >= MAX_ATTEMPTS ? "failed" : "pending",
                    last_error: String(err?.message ?? err).slice(0, 500),
                })
                .eq("id", job.id);
            failed++;
        }
    }

    await cleanupOldJobs(admin);
    await emitQueueMetrics({ processed, failed, coalesced });

    return NextResponse.json({
        ok: true,
        processed,
        coalesced,
        failed,
        ms: Date.now() - t0,
    });
}

// ─── Fallback sem RPC (sem garantia de exclusividade entre instâncias) ─────────

async function runFallbackProcessing(admin: ReturnType<typeof createAdminClient>, t0: number) {
    const { data: jobs } = await admin
        .from("chatbot_queue")
        .select("*")
        .eq("status", "pending")
        .lt("attempts", MAX_ATTEMPTS)
        .order("scheduled_at", { ascending: true })
        .limit(BATCH_SIZE);

    if (!jobs?.length) {
        await cleanupOldJobs(admin);
        await emitQueueMetrics({ processed: 0, failed: 0, coalesced: 0 });
        return NextResponse.json({ ok: true, processed: 0, ms: Date.now() - t0 });
    }

    // Marca como processing imediatamente (best-effort, sem garantia entre instâncias)
    // O campo attempts é incrementado individualmente abaixo por job

    let processed = 0;
    let failed = 0;
    let coalesced = 0;
    const seenInBatch = new Set<string>();

    const fallbackJobList = interleaveQueueJobsByCompany(jobs);

    for (const job of fallbackJobList) {
        try {
            const coalesceKey = buildCoalesceKey(
                job.thread_id,
                job.phone_e164,
                job.company_id,
                job.body_text,
                job.metadata?.message_type ?? null
            );
            const shouldCoalesce =
                coalesceKey &&
                (
                    seenInBatch.has(coalesceKey) ||
                    await hasRecentEquivalentProcessed(admin, job, coalesceKey)
                );

            if (shouldCoalesce) {
                console.info("[process-queue] inbound coalesced (fallback)", {
                    companyId: job.company_id,
                    threadId: job.thread_id,
                    messageId: job.message_id,
                    body: String(job.body_text ?? "").slice(0, 64),
                    messageType: job.metadata?.message_type ?? null,
                });
                await admin
                    .from("chatbot_queue")
                    .update({
                        status: "done",
                        last_error: "coalesced_duplicate_inbound",
                    })
                    .eq("id", job.id);
                processed++;
                coalesced++;
                continue;
            }

            if (coalesceKey) seenInBatch.add(coalesceKey);
            await admin
                .from("chatbot_queue")
                .update({ status: "processing", attempts: (job.attempts ?? 0) + 1 })
                .eq("id", job.id);

            await processJob(admin, job);

            await admin
                .from("chatbot_queue")
                .update({ status: "done" })
                .eq("id", job.id);
            processed++;
        } catch (err: any) {
            console.error("[process-queue] fallback job falhou:", job.id, err?.message);
            const attempts = (job.attempts ?? 0) + 1;
            await admin
                .from("chatbot_queue")
                .update({
                    status:     attempts >= MAX_ATTEMPTS ? "failed" : "pending",
                    last_error: String(err?.message ?? err).slice(0, 500),
                })
                .eq("id", job.id);
            failed++;
        }
    }

    await cleanupOldJobs(admin);
    await emitQueueMetrics({ processed, failed, coalesced });
    return NextResponse.json({ ok: true, processed, coalesced, failed, ms: Date.now() - t0 });
}

// ─── Processa um job individual ───────────────────────────────────────────────

async function processJob(
    admin: ReturnType<typeof createAdminClient>,
    job: any
): Promise<void> {
    const { company_id, thread_id, phone_e164, message_id, body_text, profile_name } = job;

    // Carrega credenciais do canal da empresa
    const { data: channelRow } = await admin
        .from("whatsapp_channels")
        .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
        .eq("company_id", company_id)
        .eq("provider", "meta")
        .eq("status", "active")
        .maybeSingle();
    const channelMeta = channelRow?.provider_metadata as {
        catalog_flow_id?: string;
        status_flow_id?: string;
    } | null;
    if (process.env.NODE_ENV === "production") {
        if (!channelRow) {
            throw new Error("missing_active_meta_whatsapp_channel");
        }
        const pid = String(channelRow.from_identifier ?? "").trim();
        const tok = resolveChannelAccessToken(channelRow).trim();
        if (!pid) throw new Error("whatsapp_channel_missing_phone_number_id");
        if (!tok) throw new Error("whatsapp_channel_missing_access_token");
    }

    const waConfig: WaConfig = {
        phoneNumberId: channelRow?.from_identifier ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
        accessToken:   channelRow ? resolveChannelAccessToken(channelRow) : (process.env.WHATSAPP_TOKEN ?? ""),
    };
    const catalogFlowId = channelMeta?.catalog_flow_id ?? process.env.WHATSAPP_CATALOG_FLOW_ID;
    const statusFlowId = channelMeta?.status_flow_id ?? process.env.WHATSAPP_STATUS_FLOW_ID;

    // 1. Lê bot_active fresh (pode ter mudado desde que o job foi enfileirado)
    const { data: threadRow } = await admin
        .from("whatsapp_threads")
        .select("bot_active, handover_at")
        .eq("id", thread_id)
        .maybeSingle();

    if (threadRow?.bot_active === false) {
        // Verifica handover timeout (configurável via chatbots.config ou padrão 5min)
        const handoverAt     = threadRow.handover_at ? new Date(threadRow.handover_at) : null;
        const timeoutMinutes = await getHandoverTimeout(admin, company_id);
        const cutoff         = new Date(Date.now() - timeoutMinutes * 60 * 1000);

        if (!handoverAt || handoverAt > cutoff) {
            // Handover ainda ativo → não processa
            console.log("[process-queue] bot inativo (handover recente), skipping:", thread_id);
            return;
        }

        // Handover expirado → reativa
        console.log("[process-queue] reativando bot após handover expirado:", thread_id);
        await admin
            .from("whatsapp_threads")
            .update({ bot_active: true, handover_at: null })
            .eq("id", thread_id);
        await admin
            .from("chatbot_sessions")
            .delete()
            .eq("thread_id", thread_id);
        await sendWhatsAppMessage(phone_e164, REACTIVATE_MSG, waConfig);
    }

    // 2. Processa a mensagem
    await processInboundMessage({
        admin,
        companyId:   company_id,
        threadId:    thread_id,
        messageId:   message_id ?? "",
        phoneE164:   phone_e164,
        text:        body_text,
        profileName: profile_name ?? null,
        waConfig,
        catalogFlowId,
        statusFlowId,
    });
}

// ─── Timeout de handover (P2: configurável por empresa) ───────────────────────

const handoverTimeoutCache = new Map<string, { value: number; ts: number }>();

async function getHandoverTimeout(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string
): Promise<number> {
    const cached = handoverTimeoutCache.get(companyId);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.value;

    const { data } = await admin
        .from("chatbots")
        .select("config")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .maybeSingle();

    const cfg = data?.config as { handover_timeout_minutes?: unknown } | undefined;
    const minutes = Number(cfg?.handover_timeout_minutes ?? 5);
    const value   = Number.isNaN(minutes) || minutes < 1 ? 5 : minutes;
    handoverTimeoutCache.set(companyId, { value, ts: Date.now() });
    return value;
}

// ─── Limpeza de jobs antigos ──────────────────────────────────────────────────

async function cleanupOldJobs(admin: ReturnType<typeof createAdminClient>) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await admin
        .from("chatbot_queue")
        .delete()
        .in("status", ["done", "failed"])
        .lt("created_at", cutoff);
}

function normalizeInboundText(text: string): string {
    return text
        .normalize("NFD")
        .replaceAll(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replaceAll(/\s+/g, " ")
        .trim();
}

function isCriticalOrderConfirmationText(normalizedText: string): boolean {
    if (!normalizedText) return false;
    const confirmationIds = new Set([
        "sim",
        "ok",
        "okay",
        "confirmar",
        "confirmo",
        "confirmar_pedido",
        "confirm_order",
        "pro_confirm_order",
        "btn_confirm_order",
        "btn_confirmar",
        "pro_confirm_saved_address",
        "pro_confirm_typed_address",
    ]);
    if (confirmationIds.has(normalizedText)) return true;
    return /^(sim|ok|confirmo|confirmar|pode confirmar|pode fechar|fechar pedido?)$/u.test(normalizedText);
}

function shouldSkipCoalesceByPayload(params: {
    normalizedText: string;
    messageType?: string | null;
}): boolean {
    const { normalizedText, messageType } = params;
    if (!normalizedText) return true;
    if (isCriticalOrderConfirmationText(normalizedText)) return true;
    if (normalizedText.length <= 6) return true;
    if (messageType === "interactive") return true;
    return false;
}

function buildCoalesceKey(
    threadId: string | null | undefined,
    phoneE164: string | null | undefined,
    companyId: string | null | undefined,
    bodyText: string | null | undefined,
    messageType?: string | null
): string | null {
    const owner = phoneE164 || threadId || companyId || "global";
    if (!owner || !bodyText) return null;
    const normalized = normalizeInboundText(bodyText);
    if (shouldSkipCoalesceByPayload({ normalizedText: normalized, messageType })) return null;
    return `${owner}::${normalized}`;
}

async function hasRecentEquivalentProcessed(
    admin: ReturnType<typeof createAdminClient>,
    job: {
        id: string;
        thread_id?: string;
        phone_e164?: string;
        company_id?: string;
        body_text?: string;
        created_at?: string;
        metadata?: { message_type?: string | null } | null;
    },
    coalesceKey: string
): Promise<boolean> {
    const threadId = job.thread_id;
    const phoneE164 = job.phone_e164;
    const companyId = job.company_id;
    if (!threadId && !phoneE164 && !companyId) return false;
    const cutoff = new Date(Date.now() - INBOUND_COALESCE_WINDOW_SECONDS * 1000).toISOString();
    const [byThread, byPhone, byCompany] = await Promise.all([
        threadId
            ? admin
                .from("chatbot_queue")
                .select("id, thread_id, phone_e164, company_id, body_text, metadata")
                .eq("thread_id", threadId)
                .in("status", ["done", "processing"])
                .gte("created_at", cutoff)
                .limit(30)
            : Promise.resolve({ data: [], error: null }),
        phoneE164
            ? admin
                .from("chatbot_queue")
                .select("id, thread_id, phone_e164, company_id, body_text, metadata")
                .eq("phone_e164", phoneE164)
                .in("status", ["done", "processing"])
                .gte("created_at", cutoff)
                .limit(30)
            : Promise.resolve({ data: [], error: null }),
        companyId
            ? admin
                .from("chatbot_queue")
                .select("id, thread_id, phone_e164, company_id, body_text, metadata")
                .eq("company_id", companyId)
                .in("status", ["done", "processing"])
                .gte("created_at", cutoff)
                .limit(30)
            : Promise.resolve({ data: [], error: null }),
    ]);

    const recent = [...(byThread.data ?? []), ...(byPhone.data ?? []), ...(byCompany.data ?? [])];
    for (const row of recent) {
        if (row.id === job.id) continue;
        const key = buildCoalesceKey(
            row.thread_id as string | null | undefined,
            row.phone_e164 as string | null | undefined,
            row.company_id as string | null | undefined,
            row.body_text as string | null | undefined,
            (row.metadata as { message_type?: string | null } | null | undefined)?.message_type ?? null
        );
        if (key && key === coalesceKey) return true;
    }
    return false;
}

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;
    return Math.floor(value);
}

async function emitQueueMetrics(counts: { processed: number; failed: number; coalesced: number }) {
    const payload = {
        source: "chatbot_process_queue",
        ts: Date.now(),
        ...counts,
    };

    const ingestUrl = process.env.METRICS_INGEST_URL;
    if (ingestUrl) {
        try {
            const headers: Record<string, string> = { "content-type": "application/json" };
            if (process.env.METRICS_INGEST_TOKEN) {
                headers.authorization = `Bearer ${process.env.METRICS_INGEST_TOKEN}`;
            }
            await fetch(ingestUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            return;
        } catch {
            // fallback para console abaixo
        }
    }

    console.info("[metric] chatbot_process_queue", payload);
}

async function handleClaimError(
    admin: ReturnType<typeof createAdminClient>,
    t0: number,
    claimErr: { message?: string } | null
) {
    const message = claimErr?.message ?? "claim rpc unavailable";
    if (!ALLOW_CLAIM_FALLBACK) {
        console.error("[process-queue] RPC claim_chatbot_queue_jobs indisponível em modo fail-fast:", message);
        await emitQueueMetrics({ processed: 0, failed: 1, coalesced: 0 });
        return NextResponse.json(
            { ok: false, error: "claim_rpc_unavailable", failed: 1, ms: Date.now() - t0 },
            { status: 503 }
        );
    }

    // Fallback só fora de produção (em prod o claim RPC é obrigatório).
    console.warn("[process-queue] RPC claim_chatbot_queue_jobs não encontrada, usando fallback:", message);
    return runFallbackProcessing(admin, t0);
}
