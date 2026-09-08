import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    BotRestoreReason,
    ThreadBotStatePort,
} from "@/src/pro/ports/threadControl.port";
import { ThreadControlSupabaseAdapter } from "@/src/pro/adapters/supabase/threadControl.supabase";

export type RestoreBotOutcome =
    | { ok: true; restored: true }
    | { ok: true; restored: false; reason: "noop_bot_already_active" }
    | { ok: false; error: unknown };

export async function restoreBotAfterConfirmation(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    reason: BotRestoreReason;
    nowIso?: string;
    port?: ThreadBotStatePort;
}): Promise<RestoreBotOutcome> {
    const { admin, companyId, threadId, reason } = params;
    const nowIso = params.nowIso ?? new Date().toISOString();
    const port: ThreadBotStatePort =
        params.port ?? new ThreadControlSupabaseAdapter(admin);

    const { data: thread } = await admin
        .from("whatsapp_threads")
        .select("bot_active")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (thread?.bot_active === true) {
        return { ok: true, restored: false, reason: "noop_bot_already_active" };
    }

    try {
        await port.restoreBotAfterHandover({
            companyId,
            threadId,
            reason,
            restoredAtIso: nowIso,
        });
        return { ok: true, restored: true };
    } catch (error) {
        return { ok: false, error };
    }
}
