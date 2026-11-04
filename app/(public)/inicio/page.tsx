import type { Metadata } from "next";
import { headers } from "next/headers";
import { MarketingHome } from "@/components/marketing/MarketingHome";
import { isMarketingHostname } from "@/lib/marketing/hosts";
import { resolveRequestHostname } from "@/lib/platform/resolvePlatformRequestHost";

export const metadata: Metadata = {
    title: "Zampell Delivery — pedido no WhatsApp, sem comissão por venda",
    description:
        "Agente de IA no WhatsApp da loja, cardápio web e PDV. Mensalidade fixa no lugar da comissão de iFood, Aiqfome e 99Food.",
};

export default async function InicioPage() {
    const host = resolveRequestHostname(await headers());
    return <MarketingHome linkToApp={isMarketingHostname(host)} />;
}
