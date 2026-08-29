/**
 * Núcleo do worker outbound — reutilizável por outbound-worker HTTP e Lambda SQS (ADR-0003).
 */

import "server-only";
import { getWaConfig } from "@/lib/whatsapp/waConfigCache";
import { storeHoursFromRow } from "@/lib/delivery/hours";
import {
    evaluateOutboundGates,
    type BusinessHours,
} from "@/lib/chatbot/outbound/gates";
import { sendOutboundPayload } from "@/lib/chatbot/outbound/sendOutbound";
import {
    isOutboundJobPayload,
    type OutboundJobRow,
} from "@/lib/chatbot/outbound/types";
import { markRecipientFromOutboundJob } from "@/lib/campaigns/enqueueCampaign";
import type { AdminClient } from "@/lib/chatbot/queue/types";

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;
    return Math.floor(value);
}

const MAX_ATTEMPTS = getPositiveIntEnv("OUTBOUND_MAX_ATTEMPTS", 3);
const FREQUENCY_WINDOW_HOURS = getPositiveIntEnv("OUTBOUND_FREQUENCY_WINDOW_HOURS", 72);
const MAX_PER_CUSTOMER = getPositiveIntEnv("OUTBOUND_MAX_PER_CUSTOMER", 1);

export type ProcessOutboundJobOutcome = "sent" | "skipped" | "failed";

export type ProcessOutboundJobResult =
    | { ok: true; outcome: ProcessOutboundJobOutcome; job: OutboundJobRow; reason?: string }
    | { ok: false; error: "job_not_found" | "job_not_runnable"; jobId: string };

type JobContext = {
    botActive: boolean | null;
    lastInboundAt: string | null;
    cartStatus: string | null;
    recentProactiveCount: number;
    businessHours: BusinessHours | null;
};

async function loadSingleJobContext(
    admin: AdminClient,
    job: OutboundJobRow
): Promise<JobContext> {
    const frequencyCutoff = new Date(
        Date.now() - FREQUENCY_WINDOW_HOURS * 3_600_000
    ).toISOString();

    const [threadRes, settingsRes, cartRes, recentRes] = await Promise.all([
        admin
            .from("whatsapp_threads")
            .select("id, bot_active, last_inbound_at")
            .eq("id", job.thread_id)
            .maybeSingle(),
        admin
            .from("company_settings")
            .select("company_id, opening_periods, open_time, close_time, timezone")
            .eq("company_id", job.company_id)
            .maybeSingle(),
        job.purpose === "cart_recovery" && job.source_id
            ? admin
                  .from("abandoned_carts")
                  .select("id, status")
                  .eq("id", job.source_id)
                  .maybeSingle()
            : Promise.resolve({ data: null as { id: string; status: string } | null }),
        admin
            .from("outbound_jobs")
            .select("thread_id")
            .eq("thread_id", job.thread_id)
            .neq("purpose", "transactional")
            .gte("sent_at", frequencyCutoff),
    ]);

    let businessHours: BusinessHours | null = null;
    if (settingsRes.data) {
        const hours = storeHoursFromRow(settingsRes.data);
        businessHours = {
            openTime: hours.openTime,
            closeTime: hours.closeTime,
            timeZone: hours.timeZone,
            periods: hours.periods,
        };
    }

    return {
        botActive: (threadRes.data?.bot_active as boolean | null) ?? null,
        lastInboundAt: (threadRes.data?.last_inbound_at as string | null) ?? null,
        cartStatus: cartRes.data ? String(cartRes.data.status) : null,
        recentProactiveCount: (recentRes.data ?? []).length,
        businessHours,
    };
}

/**
 * Carrega outbound_jobs por id e processa um envio (gates + Meta).
 * Marca processing via attempts já incrementados pelo claim; no caminho SQS
 * o caller deve garantir status=processing ou marcar antes.
 */
export async function processOutboundJobById(
    admin: AdminClient,
    jobId: string
): Promise<ProcessOutboundJobResult> {
    const { data, error } = await admin
        .from("outbound_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();

    if (error || !data) {
        return { ok: false, error: "job_not_found", jobId };
    }

    const job = data as unknown as OutboundJobRow & { status?: string; last_error?: string | null };
    if (job.status === "done" || job.status === "failed" || job.status === "skipped") {
        return { ok: false, error: "job_not_runnable", jobId };
    }

    // SQS path: ensure processing stamp if still pending
    if (job.status === "pending") {
        await admin
            .from("outbound_jobs")
            .update({
                status: "processing",
                attempts: (job.attempts ?? 0) + 1,
                processing_started_at: new Date().toISOString(),
            })
            .eq("id", job.id);
        job.attempts = (job.attempts ?? 0) + 1;
    }

    const ctx = await loadSingleJobContext(admin, job);
    const hasPayload = isOutboundJobPayload(job.payload);
    const decision = evaluateOutboundGates({
        purpose: job.purpose,
        nowMs: Date.now(),
        hasPayload,
        lastInboundAt: ctx.lastInboundAt,
        botActive: ctx.botActive,
        cartStatus: ctx.cartStatus,
        recentProactiveCount: ctx.recentProactiveCount,
        maxProactivePerWindow: MAX_PER_CUSTOMER,
        businessHours: ctx.businessHours,
    });

    if (!decision.allow) {
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
        return { ok: true, outcome: "skipped", job, reason: decision.reason };
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

        return { ok: true, outcome: "sent", job };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[processOutboundJobById] envio falhou:", job.id, message);
        const terminal = job.attempts >= MAX_ATTEMPTS;
        await admin
            .from("outbound_jobs")
            .update({
                status: terminal ? "failed" : "pending",
                last_error: message.slice(0, 500),
            })
            .eq("id", job.id);

        if (
            job.purpose === "broadcast_template" &&
            terminal &&
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

        return { ok: true, outcome: "failed", job, reason: message };
    }
}
