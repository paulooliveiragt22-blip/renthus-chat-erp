/**
 * Religa o bot da thread (limpa handover). Espelha POST bot-toggle com
 * bot_active=true: sem limpar sessão, `step=handover` engole inbound.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function resumeThreadBot(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
}): Promise<void> {
    const { admin, companyId, threadId } = params;
    await Promise.all([
        admin
            .from("whatsapp_threads")
            .update({ bot_active: true, handover_at: null })
            .eq("id", threadId)
            .eq("company_id", companyId),
        admin.from("chatbot_sessions").delete().eq("thread_id", threadId).eq("company_id", companyId),
    ]);
}
