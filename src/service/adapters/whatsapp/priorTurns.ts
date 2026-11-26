import type { SupabaseClient } from "@supabase/supabase-js";
import type { SiteChatPriorTurn } from "@/src/service/domain/siteChat";

const HISTORY_LIMIT = 12;

type MessageRow = {
    id?: unknown;
    direction?: unknown;
    body?: unknown;
};

export function priorTurnsFromRows(rows: readonly MessageRow[], currentMessageId: string): SiteChatPriorTurn[] {
    const turns: SiteChatPriorTurn[] = [];
    for (const row of rows) {
        if (typeof row.id === "string" && row.id === currentMessageId) continue;
        if (typeof row.body !== "string" || row.body.trim().length === 0) continue;
        const role = row.direction === "outbound" ? "assistant" : row.direction === "inbound" ? "user" : null;
        if (!role) continue;
        turns.push({ role, text: row.body });
    }
    return turns.slice(-HISTORY_LIMIT);
}

export async function loadWhatsappPriorTurns(
    admin: SupabaseClient,
    threadId: string,
    currentMessageId: string
): Promise<SiteChatPriorTurn[]> {
    const { data, error } = await admin
        .from("whatsapp_messages")
        .select("id, direction, body")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT + 1);
    if (error || !Array.isArray(data)) return [];
    return priorTurnsFromRows([...data].reverse(), currentMessageId);
}
