import type { Metadata } from "next";
import { headers } from "next/headers";
import { MarketingHome } from "@/components/marketing/MarketingHome";
import { isMarketingHostname } from "@/lib/marketing/hosts";
import { resolveRequestHostname } from "@/lib/platform/resolvePlatformRequestHost";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSiteChatPublicCompany } from "@/src/service/adapters/site/siteChatRpc";
import { ZAMPELL_SERVICE_COMPANY_ID } from "@/src/service/application/siteChatCompany";

export const metadata: Metadata = {
    title: "Zampell Delivery — pedido no WhatsApp, sem comissão por venda",
    description:
        "Pra hamburgueria, pizzaria, restaurante e delivery. Agente de IA no WhatsApp, cardápio web e PDV — mensalidade fixa, sem comissão por pedido.",
};

export default async function InicioPage() {
    const host = resolveRequestHostname(await headers());
    const siteChat = await loadZampellChat();
    return <MarketingHome linkToApp={isMarketingHostname(host)} siteChat={siteChat} />;
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
        console.warn("[site-chat] landing", error instanceof Error ? error.message : "failed");
        return null;
    }
}
