import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, ProSessionState, TenantRef } from "@/src/types/contracts";
import type { EnvLike } from "@/lib/env/EnvLike";

export function isPipelineTurnTraceEnabled(
    env: EnvLike = process.env
): boolean {
    const v = env.PRO_PIPELINE_TURN_TRACE?.trim().toLowerCase() ?? "";
    return v === "1" || v === "true" || v === "yes" || v === "on";
}

function outboundForTrace(outbound: OutboundMessage[]) {
    return outbound.map((m) => {
        if (m.kind === "text") return { kind: m.kind, text: m.text };
        if (m.kind === "flow") return { kind: m.kind, text: m.flow?.bodyText };
        if (m.kind === "buttons") {
            const titles = (m.buttons ?? []).map((b) => b.title).join(" | ");
            return { kind: m.kind, text: m.text || titles || undefined };
        }
        return { kind: "text" as const, text: undefined };
    });
}

/**
 * Best-effort: nunca quebra o turno do bot.
 * Upsert por (company_id, inbound_message_id).
 */
export async function recordPipelineTurnTrace(params: {
    admin: SupabaseClient;
    tenant: TenantRef;
    stateBefore: ProSessionState;
    stateAfter: ProSessionState;
    outbound: OutboundMessage[];
    aiProfile?: string | null;
    telemetryReason?: string | null;
}): Promise<void> {
    if (!isPipelineTurnTraceEnabled()) return;

    const raw = String(params.tenant.messagingChannel ?? "whatsapp");
    const channel =
        raw === "instagram" || raw === "messenger" || raw === "web" ? raw : "whatsapp";

    const row = {
        v: 1,
        company_id: params.tenant.companyId,
        thread_id: params.tenant.threadId,
        channel,
        inbound_message_id: params.tenant.messageId,
        state_before: params.stateBefore as unknown as Record<string, unknown>,
        state_after: params.stateAfter as unknown as Record<string, unknown>,
        outbound: outboundForTrace(params.outbound),
        draft_snapshot: (params.stateAfter.draft ?? null) as unknown,
        telemetry_reason: params.telemetryReason ?? null,
        ai_profile: params.aiProfile ?? null,
    };

    try {
        const { error } = await params.admin.from("pipeline_turn_traces").upsert(row, {
            onConflict: "company_id,inbound_message_id",
        });
        if (error) {
            console.warn("[pipeline_turn_traces] upsert failed:", error.message);
        }
    } catch (e) {
        console.warn(
            "[pipeline_turn_traces] upsert threw:",
            e instanceof Error ? e.message : e
        );
    }
}
