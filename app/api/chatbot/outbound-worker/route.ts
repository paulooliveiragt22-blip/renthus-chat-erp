/**
 * app/api/chatbot/outbound-worker/route.ts
 *
 * Worker da fila de mensagens proativas (`outbound_jobs`).
 *
 * Mesmo desenho do `process-queue`: reclaim → claim atómico com fairness por
 * empresa → processa → done/failed/skipped.
 *
 * Os gates são reavaliados aqui, no envio: entre enfileirar e enviar o cliente
 * pode ter fechado o pedido, um humano pode ter assumido a conversa ou a janela
 * de 24h pode ter fechado.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { getWaConfig } from "@/lib/whatsapp/waConfigCache";
import { storeHoursFromRow } from "@/lib/delivery/hours";
import {
    evaluateOutboundGates,
    type BusinessHours,
} from "@/lib/chatbot/outbound/gates";
import { sendOutboundPayload } from "@/lib/chatbot/outbound/sendOutbound";
import { isOutboundJobPayload, type OutboundJobRow } from "@/lib/chatbot/outbound/types";
import { markRecipientFromOutboundJob } from "@/lib/campaigns/enqueueCampaign";

export const runtime = "nodejs";
export const maxDuration = 60;

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;
    return Math.floor(value);
}

const BATCH_SIZE = getPositiveIntEnv("OUTBOUND_WORKER_BATCH", 10);
const MAX_ATTEMPTS = getPositiveIntEnv("OUTBOUND_MAX_ATTEMPTS", 3);
const MAX_PER_COMPANY = getPositiveIntEnv("OUTBOUND_MAX_PER_COMPANY", 3);
const STALE_MINUTES = getPositiveIntEnv("OUTBOUND_STALE_MINUTES", 5);
const FREQUENCY_WINDOW_HOURS = getPositiveIntEnv("OUTBOUND_FREQUENCY_WINDOW_HOURS", 72);
const MAX_PER_CUSTOMER = getPositiveIntEnv("OUTBOUND_MAX_PER_CUSTOMER", 1);
const JOB_RETENTION_DAYS = getPositiveIntEnv("OUTBOUND_JOB_RETENTION_DAYS", 30);

type Admin = ReturnType<typeof createAdminClient>;

interface JobContext {
    botActive: boolean | null;
    lastInboundAt: string | null;
    cartStatus: string | null;
    recentProactiveCount: number;
    businessHours: BusinessHours | null;
}

export async function GET(req: Request) {
    const authError = validateCronAuthorization(req.headers.get("authorization"));
    if (authError) return authError;

    const admin = createAdminClient();
    const t0 = Date.now();

    let reclaimed = 0;
    try {
        const { data } = await admin.rpc("reclaim_stuck_outbound_jobs", {
            stale_minutes: STALE_MINUTES,
        });
        reclaimed = Number(data ?? 0) || 0;
    } catch (err: unknown) {
        console.warn(
            "[outbound-worker] reclaim falhou:",
            err instanceof Error ? err.message : err
        );
    }

    const { data: claimed, error: claimErr } = await admin.rpc("claim_outbound_jobs", {
        batch_size: BATCH_SIZE,
        max_attempts: MAX_ATTEMPTS,
        max_per_company: MAX_PER_COMPANY,
    });

    if (claimErr) {
        console.error("[outbound-worker] claim falhou:", claimErr.message);
        return NextResponse.json(
            { ok: false, error: "claim_rpc_unavailable", ms: Date.now() - t0 },
            { status: 503 }
        );
    }

    const jobIds = ((claimed ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (jobIds.length === 0) {
        await cleanupOldJobs(admin);
        return NextResponse.json({ ok: true, sent: 0, reclaimed, ms: Date.now() - t0 });
    }

    const { data: jobRows } = await admin.from("outbound_jobs").select("*").in("id", jobIds);
    const jobs = (jobRows ?? []) as unknown as OutboundJobRow[];
    const contexts = await loadJobContexts(admin, jobs);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const job of jobs) {
        const ctx = contexts.get(job.id);
        const hasPayload = isOutboundJobPayload(job.payload);
        const decision = evaluateOutboundGates({
            purpose: job.purpose,
            nowMs: Date.now(),
            hasPayload,
            lastInboundAt: ctx?.lastInboundAt ?? null,
            botActive: ctx?.botActive ?? null,
            cartStatus: ctx?.cartStatus ?? null,
            recentProactiveCount: ctx?.recentProactiveCount ?? 0,
            maxProactivePerWindow: MAX_PER_CUSTOMER,
            businessHours: ctx?.businessHours ?? null,
        });

        if (!decision.allow) {
            skipped++;
            await admin
                .from("outbound_jobs")
                .update({ status: "skipped", skip_reason: decision.reason })
                .eq("id", job.id);
            if (job.purpose === "broadcast_template" && isOutboundJobPayload(job.payload)) {
                const p = job.payload;
                if (p.kind === "template") {
                    await markRecipientFromOutboundJob({
                        admin,
                        recipientId: p.recipientId,
                        campaignId: p.campaignId,
                        outcome: "skipped",
                        error: decision.reason,
                    });
                }
            }
            console.info("[outbound-worker] job ignorado", {
                jobId: job.id,
                purpose: job.purpose,
                reason: decision.reason,
            });
            continue;
        }

        try {
            const waConfig = await getWaConfig(admin, job.company_id);
            if (!waConfig?.phoneNumberId || !waConfig.accessToken) {
                throw new Error("missing_active_meta_whatsapp_channel");
            }

            const result = await sendOutboundPayload({
                admin,
                threadId: job.thread_id,
                phoneE164: job.phone_e164,
                payload: job.payload,
                waConfig,
            });

            if (!result.ok) throw new Error(result.error ?? "send_failed");

            await admin
                .from("outbound_jobs")
                .update({
                    status: "done",
                    sent_at: new Date().toISOString(),
                    sent_message_id: result.providerMessageId ?? null,
                })
                .eq("id", job.id);

            if (job.purpose === "cart_recovery" && job.source_id) {
                await admin
                    .from("abandoned_carts")
                    .update({ status: "notified", notified_at: new Date().toISOString() })
                    .eq("id", job.source_id)
                    .eq("status", "open");
            }

            if (job.purpose === "broadcast_template" && isOutboundJobPayload(job.payload)) {
                const p = job.payload;
                if (p.kind === "template") {
                    await markRecipientFromOutboundJob({
                        admin,
                        recipientId: p.recipientId,
                        campaignId: p.campaignId,
                        outcome: "sent",
                    });
                }
            }

            sent++;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[outbound-worker] envio falhou:", job.id, message);
            await admin
                .from("outbound_jobs")
                .update({
                    status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
                    last_error: message.slice(0, 500),
                })
                .eq("id", job.id);
            if (
                job.purpose === "broadcast_template" &&
                job.attempts >= MAX_ATTEMPTS &&
                isOutboundJobPayload(job.payload)
            ) {
                const p = job.payload;
                if (p.kind === "template") {
                    await markRecipientFromOutboundJob({
                        admin,
                        recipientId: p.recipientId,
                        campaignId: p.campaignId,
                        outcome: "failed",
                        error: message,
                    });
                }
            }
            failed++;
        }
    }

    await cleanupOldJobs(admin);

    console.info("[metric] outbound_worker", { sent, skipped, failed, reclaimed });

    return NextResponse.json({
        ok: true,
        claimed: jobIds.length,
        sent,
        skipped,
        failed,
        reclaimed,
        ms: Date.now() - t0,
    });
}

async function loadJobContexts(
    admin: Admin,
    jobs: OutboundJobRow[]
): Promise<Map<string, JobContext>> {
    const contexts = new Map<string, JobContext>();
    if (jobs.length === 0) return contexts;

    const threadIds = [...new Set(jobs.map((j) => j.thread_id))];
    const companyIds = [...new Set(jobs.map((j) => j.company_id))];
    const cartIds = jobs
        .filter((j) => j.purpose === "cart_recovery" && j.source_id)
        .map((j) => j.source_id as string);
    const frequencyCutoff = new Date(
        Date.now() - FREQUENCY_WINDOW_HOURS * 3_600_000
    ).toISOString();

    const [threadsRes, settingsRes, cartsRes, recentRes] = await Promise.all([
        admin
            .from("whatsapp_threads")
            .select("id, bot_active, last_inbound_at")
            .in("id", threadIds),
        admin
            .from("company_settings")
            .select("company_id, opening_periods, open_time, close_time, timezone")
            .in("company_id", companyIds),
        cartIds.length > 0
            ? admin.from("abandoned_carts").select("id, status").in("id", cartIds)
            : Promise.resolve({ data: [] as Array<{ id: string; status: string }> }),
        admin
            .from("outbound_jobs")
            .select("thread_id")
            .in("thread_id", threadIds)
            .neq("purpose", "transactional")
            .gte("sent_at", frequencyCutoff),
    ]);

    const businessHoursByCompany = new Map<string, BusinessHours>();
    for (const row of settingsRes.data ?? []) {
        const hours = storeHoursFromRow(row);
        businessHoursByCompany.set(String(row.company_id), {
            openTime: hours.openTime,
            closeTime: hours.closeTime,
            timeZone: hours.timeZone,
            periods: hours.periods,
        });
    }

    const cartStatusById = new Map<string, string>();
    for (const row of cartsRes.data ?? []) {
        cartStatusById.set(String(row.id), String(row.status));
    }

    const recentByThread = new Map<string, number>();
    for (const row of recentRes.data ?? []) {
        const key = String(row.thread_id);
        recentByThread.set(key, (recentByThread.get(key) ?? 0) + 1);
    }

    const threadById = new Map<string, { bot_active: boolean | null; last_inbound_at: string | null }>();
    for (const row of threadsRes.data ?? []) {
        threadById.set(String(row.id), {
            bot_active: row.bot_active as boolean | null,
            last_inbound_at: row.last_inbound_at as string | null,
        });
    }

    /** Indexado por job: dois jobs da mesma thread podem cair no mesmo lote. */
    for (const job of jobs) {
        const thread = threadById.get(job.thread_id);
        contexts.set(job.id, {
            botActive: thread?.bot_active ?? null,
            lastInboundAt: thread?.last_inbound_at ?? null,
            cartStatus: job.source_id ? cartStatusById.get(job.source_id) ?? null : null,
            recentProactiveCount: recentByThread.get(job.thread_id) ?? 0,
            businessHours: businessHoursByCompany.get(job.company_id) ?? null,
        });
    }

    return contexts;
}

async function cleanupOldJobs(admin: Admin): Promise<void> {
    const cutoff = new Date(Date.now() - JOB_RETENTION_DAYS * 86_400_000).toISOString();
    await admin
        .from("outbound_jobs")
        .delete()
        .in("status", ["done", "failed", "skipped"])
        .lt("created_at", cutoff);
}
