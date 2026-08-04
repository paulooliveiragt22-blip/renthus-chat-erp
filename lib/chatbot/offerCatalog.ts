/**
 * Oferece catálogo ao cliente: link do cardápio web (se ativo) ou WhatsApp Flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendFlowMessage, type WaConfig } from "../whatsapp/send";
import { resolveActivePublicMenuLink } from "../public-menu/resolveActiveMenuLink";
import { buildWebMenuOfferText } from "../public-menu/menuOfferText";
import { botReply } from "./botSend";
import { saveSession } from "./session";
import type { Session } from "./types";

export type CatalogOfferResult = "web_menu" | "flow" | "none";

export async function offerCatalogToCustomer(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    phoneE164: string;
    companyName: string;
    session: Pick<Session, "context">;
    waConfig?: WaConfig | null;
    flowCatalogId?: string | null;
    /** Corpo do Flow quando fallback Flow. */
    flowBodyText?: string;
    flowCtaLabel?: string;
}): Promise<CatalogOfferResult> {
    const {
        admin,
        companyId,
        threadId,
        phoneE164,
        companyName,
        session,
        waConfig,
        flowCatalogId,
        flowBodyText,
        flowCtaLabel,
    } = params;

    const web = await resolveActivePublicMenuLink(admin, companyId);
    if (web) {
        await botReply(
            admin,
            companyId,
            threadId,
            phoneE164,
            buildWebMenuOfferText({ url: web.url, companyName })
        );
        return "web_menu";
    }

    if (flowCatalogId && waConfig) {
        await saveSession(admin, threadId, companyId, {
            step: "awaiting_flow",
            context: {
                ...session.context,
                flow_started_at: new Date().toISOString(),
                flow_repeat_count: 0,
            },
        });
        await sendFlowMessage(
            phoneE164,
            {
                flowId: flowCatalogId,
                flowToken: `${threadId}|${companyId}|catalog`,
                bodyText:
                    flowBodyText ??
                    `Escolha o que você quer pedir no *${companyName}*!`,
                ctaLabel: flowCtaLabel ?? "Ver Catálogo",
            },
            waConfig
        );
        return "flow";
    }

    return "none";
}
