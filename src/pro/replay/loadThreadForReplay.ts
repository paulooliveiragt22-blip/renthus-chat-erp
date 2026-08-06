/**
 * Loader de conversa para o harness de replay (Fase 1).
 * Uso: carregar inbound/outbound ordenados por thread.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReplayThreadMessage = {
    id: string;
    direction: string;
    body: string | null;
    created_at: string;
    sender_type: string | null;
    provider_message_id: string | null;
    channel: string | null;
};

export async function loadThreadMessagesForReplay(
    admin: SupabaseClient,
    params: { companyId: string; threadId: string; limit?: number }
): Promise<ReplayThreadMessage[]> {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const { data: thread, error: thErr } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("id", params.threadId)
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (thErr) throw new Error(thErr.message);
    if (!thread) throw new Error("thread_not_found");

    const { data, error } = await admin
        .from("whatsapp_messages")
        .select("id, direction, body, created_at, sender_type, provider_message_id, channel")
        .eq("thread_id", params.threadId)
        .order("created_at", { ascending: true })
        .limit(limit);

    if (error) throw new Error(error.message);
    return (data ?? []) as ReplayThreadMessage[];
}

export async function loadThreadTracesForReplay(
    admin: SupabaseClient,
    params: { companyId: string; threadId: string; limit?: number }
): Promise<
    Array<{
        id: string;
        inbound_message_id: string;
        outbound: unknown;
        telemetry_reason: string | null;
        ai_profile: string | null;
        created_at: string;
    }>
> {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const { data, error } = await admin
        .from("pipeline_turn_traces")
        .select(
            "id, inbound_message_id, outbound, telemetry_reason, ai_profile, created_at"
        )
        .eq("company_id", params.companyId)
        .eq("thread_id", params.threadId)
        .order("created_at", { ascending: true })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
        id: string;
        inbound_message_id: string;
        outbound: unknown;
        telemetry_reason: string | null;
        ai_profile: string | null;
        created_at: string;
    }>;
}
