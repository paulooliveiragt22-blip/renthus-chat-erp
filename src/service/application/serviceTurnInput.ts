import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaConfig } from "@/lib/whatsapp/send";

export type ServiceTurnInput = {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    messageId: string;
    phoneE164: string;
    text: string;
    profileName?: string | null;
    messagingChannel?: "whatsapp" | "instagram" | "messenger" | "site";
    channelUserId?: string;
    waConfig?: WaConfig;
    humanHref?: string | null;
    priorTurns?: { role: "user" | "assistant"; text: string }[];
};
