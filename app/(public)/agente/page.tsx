import type { Metadata } from "next";
import { headers } from "next/headers";
import { AttendanceHome } from "@/components/marketing/AttendanceHome";
import { isMarketingHostname } from "@/lib/marketing/hosts";
import { resolveRequestHostname } from "@/lib/platform/resolvePlatformRequestHost";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSiteChatPublicCompany } from "@/src/service/adapters/site/siteChatRpc";
import { ZAMPELL_SERVICE_COMPANY_ID } from "@/src/service/application/siteChatCompany";

export const metadata: Metadata = {
    title: "Zampell Office — agente de IA no WhatsApp",
    description:
        "Agente de IA direto no WhatsApp. Atendimento 24h, agenda e mensagens para quem parou na conversa. Mensal R$ 159 ou anual R$ 99,90 por mês.",
    alternates: { canonical: "https://www.zampell.com.br/atendimento" },
};

export default async function AgentePage() {
    const host = resolveRequestHostname(await headers());
    const siteChat = await loadZampellChat();
    return <AttendanceHome linkToApp={isMarketingHostname(host)} siteChat={siteChat} />;
}

async function loadZampellChat(): Promise<{ publicKey: string; companyName: string; replies: string[] } | null> {
    try {
        const profile = await readSiteChatPublicCompany(createAdminClient(), ZAMPELL_SERVICE_COMPANY_ID);
        if (!profile?.publicKey) return null;
        return {
            publicKey: profile.publicKey,
            companyName: profile.companyName,
            replies: profile.replies,
        };
    } catch (error: unknown) {
        console.warn("[site-chat] atendimento", error instanceof Error ? error.message : "failed");
        return null;
    }
}
