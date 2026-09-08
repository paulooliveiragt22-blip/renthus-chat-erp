import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    BotRestoreReason,
    ThreadBotStatePort,
} from "@/src/pro/ports/threadControl.port";

export class ThreadControlSupabaseAdapter implements ThreadBotStatePort {
    constructor(private readonly admin: SupabaseClient) {}

    async restoreBotAfterHandover(params: {
        companyId: string;
        threadId: string;
        reason: BotRestoreReason;
        restoredAtIso: string;
    }): Promise<void> {
        const { companyId, threadId, reason, restoredAtIso } = params;
        await this.admin
            .from("whatsapp_threads")
            .update({
                bot_active: true,
                handover_at: null,
                last_bot_restored_at: restoredAtIso,
                last_bot_restore_reason: reason,
            })
            .eq("id", threadId)
            .eq("company_id", companyId)
            .eq("bot_active", false);
    }
}
