import type { Metadata } from "next";
import { headers } from "next/headers";
import { MarketingHome } from "@/components/marketing/MarketingHome";
import { isMarketingHostname } from "@/lib/marketing/hosts";
import { resolveRequestHostname } from "@/lib/platform/resolvePlatformRequestHost";

export const metadata: Metadata = {
    title: "Zampell Delivery — pedido no WhatsApp, sem comissão por venda",
    description:
        "Pra hamburgueria, pizzaria, restaurante e delivery. Agente de IA no WhatsApp, cardápio web e PDV — mensalidade fixa, sem comissão por pedido.",
};

export default async function InicioPage() {
    const host = resolveRequestHostname(await headers());
    return <MarketingHome linkToApp={isMarketingHostname(host)} />;
}
