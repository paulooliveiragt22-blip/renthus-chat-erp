/**
 * Aviso PT-BR quando a fila da empresa está atrasada (pico).
 * Cooldown por thread em chatbot_sessions.context — sem Redis.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";

export const BACKLOG_NOTICE_TEXT =
    "⏳ Estamos com bastante movimento agora e sua mensagem já está na fila.\n" +
    "Em instantes te respondo por aqui — não precisa reenviar. Obrigado!";

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.floor(n);
}

export function getBacklogDepthThreshold(): number {
    return getPositiveIntEnv("CHATBOT_BACKLOG_DEPTH", 8);
}

export function getBacklogAgeSeconds(): number {
    return getPositiveIntEnv("CHATBOT_BACKLOG_AGE_SECONDS", 45);
}

export function getBacklogNoticeCooldownSec(): number {
    return getPositiveIntEnv("CHATBOT_BACKLOG_NOTICE_COOLDOWN_SEC", 120);
}

export type BacklogPressure = {
    pendingCount: number;
    oldestAgeSec: number;
    triggered: boolean;
    reason: "depth" | "age" | null;
};

/** Avalia pressão da fila por empresa (pending). */
export function evaluateBacklogPressure(input: {
    pendingCount: number;
    oldestScheduledAt: string | null;
    nowMs?: number;
    depthThreshold?: number;
    ageSeconds?: number;
}): BacklogPressure {
    const depthThreshold = input.depthThreshold ?? getBacklogDepthThreshold();
    const ageSeconds = input.ageSeconds ?? getBacklogAgeSeconds();
    const nowMs = input.nowMs ?? Date.now();
    const oldestAgeSec =
        input.oldestScheduledAt != null
            ? Math.max(
                  0,
                  Math.floor((nowMs - new Date(input.oldestScheduledAt).getTime()) / 1000)
              )
            : 0;

    if (input.pendingCount >= depthThreshold) {
        return {
            pendingCount: input.pendingCount,
            oldestAgeSec,
            triggered: true,
            reason: "depth",
        };
    }
    if (input.oldestScheduledAt && oldestAgeSec >= ageSeconds) {
        return {
            pendingCount: input.pendingCount,
            oldestAgeSec,
            triggered: true,
            reason: "age",
        };
    }
    return {
        pendingCount: input.pendingCount,
        oldestAgeSec,
        triggered: false,
        reason: null,
    };
}

export function shouldSendBacklogNotice(opts: {
    pressure: BacklogPressure;
    lastNoticeAtIso: string | null | undefined;
    nowMs?: number;
    cooldownSec?: number;
}): boolean {
    if (!opts.pressure.triggered) return false;
    const cooldown = opts.cooldownSec ?? getBacklogNoticeCooldownSec();
    const nowMs = opts.nowMs ?? Date.now();
    if (!opts.lastNoticeAtIso) return true;
    const last = new Date(opts.lastNoticeAtIso).getTime();
    if (!Number.isFinite(last)) return true;
    return nowMs - last >= cooldown * 1000;
}

/**
 * Se a fila da empresa estiver sob pressão, envia aviso uma vez por cooldown/thread.
 * Não lança — falhas só logam.
 */
export async function maybeSendBacklogNotice(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    phoneE164: string;
    waConfig: WaConfig;
}): Promise<{ sent: boolean; reason?: string }> {
    const { admin, companyId, threadId, phoneE164, waConfig } = params;

    try {
        const { count, error: countErr } = await admin
            .from("chatbot_queue")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .eq("status", "pending");

        if (countErr) {
            console.warn("[backlog-notice] count:", countErr.message);
            return { sent: false, reason: "count_error" };
        }

        const { data: oldestRow } = await admin
            .from("chatbot_queue")
            .select("scheduled_at")
            .eq("company_id", companyId)
            .eq("status", "pending")
            .order("scheduled_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        const pressure = evaluateBacklogPressure({
            pendingCount: count ?? 0,
            oldestScheduledAt:
                typeof oldestRow?.scheduled_at === "string" ? oldestRow.scheduled_at : null,
        });

        if (!pressure.triggered) {
            return { sent: false, reason: "no_pressure" };
        }

        const { data: session } = await admin
            .from("chatbot_sessions")
            .select("context")
            .eq("thread_id", threadId)
            .maybeSingle();

        const ctx = (session?.context ?? {}) as Record<string, unknown>;
        const lastNotice =
            typeof ctx.backlog_notice_sent_at === "string"
                ? ctx.backlog_notice_sent_at
                : null;

        if (!shouldSendBacklogNotice({ pressure, lastNoticeAtIso: lastNotice })) {
            return { sent: false, reason: "cooldown" };
        }

        const send = await sendWhatsAppMessage(phoneE164, BACKLOG_NOTICE_TEXT, waConfig);
        if (!send.ok) {
            console.warn("[backlog-notice] send failed:", send.error);
            return { sent: false, reason: "send_failed" };
        }

        const nextCtx = {
            ...ctx,
            backlog_notice_sent_at: new Date().toISOString(),
            backlog_notice_reason: pressure.reason,
        };

        if (session) {
            await admin
                .from("chatbot_sessions")
                .update({
                    context: nextCtx,
                    updated_at: new Date().toISOString(),
                })
                .eq("thread_id", threadId);
        } else {
            await admin.from("chatbot_sessions").upsert(
                {
                    thread_id: threadId,
                    company_id: companyId,
                    step: "welcome",
                    cart: [],
                    context: nextCtx,
                    updated_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 120 * 60_000).toISOString(),
                },
                { onConflict: "thread_id" }
            );
        }

        console.info("[backlog-notice] sent", {
            companyId,
            threadId,
            reason: pressure.reason,
            pendingCount: pressure.pendingCount,
            oldestAgeSec: pressure.oldestAgeSec,
        });
        return { sent: true, reason: pressure.reason ?? undefined };
    } catch (err: unknown) {
        console.warn(
            "[backlog-notice] failed:",
            err instanceof Error ? err.message : err
        );
        return { sent: false, reason: "exception" };
    }
}
