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
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;

const REACTIVATE_MSG =
    "😔 No momento não há atendentes disponíveis.\n" +
    "Mas não se preocupe — nosso assistente automático está de volta para te ajudar!\n\n" +
    "Digite qualquer mensagem para continuar seu pedido.";

export async function GET(req: Request) {
    // Vercel cron passa o header Authorization com o CRON_SECRET
    const authHeader = req.headers.get("authorization");
    if (
        process.env.CRON_SECRET &&
        authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        // RPC não existe ainda → fallback simples (sem concorrência garantida)
        console.warn("[process-queue] RPC claim_chatbot_queue_jobs não encontrada, usando fallback:", claimErr.message);
        return runFallbackProcessing(admin, t0);
    }

    const jobIds: string[] = (claimed ?? []).map((r: any) => r.id);
    if (!jobIds.length) {
        await cleanupOldJobs(admin);
        return NextResponse.json({ ok: true, processed: 0, ms: Date.now() - t0 });
    }

    // Busca detalhes dos jobs claimados
    const { data: jobs } = await admin
        .from("chatbot_queue")
        .select("*")
        .in("id", jobIds);

    let processed = 0;
    let failed = 0;

    for (const job of jobs ?? []) {
        try {
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

    return NextResponse.json({
        ok: true,
        processed,
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
        return NextResponse.json({ ok: true, processed: 0, ms: Date.now() - t0 });
    }

    // Marca como processing imediatamente (best-effort, sem garantia entre instâncias)
    // O campo attempts é incrementado individualmente abaixo por job

    let processed = 0;
    let failed = 0;

    for (const job of jobs) {
        try {
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
    return NextResponse.json({ ok: true, processed, failed, ms: Date.now() - t0 });
}

// ─── Processa um job individual ───────────────────────────────────────────────

async function processJob(
    admin: ReturnType<typeof createAdminClient>,
    job: any
): Promise<void> {
    const { company_id, thread_id, phone_e164, message_id, body_text, profile_name, metadata } = job;

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
        await sendWhatsAppMessage(phone_e164, REACTIVATE_MSG);
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

    const minutes = Number((data?.config as any)?.handover_timeout_minutes ?? 5);
    const value   = isNaN(minutes) || minutes < 1 ? 5 : minutes;
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
