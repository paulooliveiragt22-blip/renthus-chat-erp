import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { QueueRetryableError } from "@/lib/chatbot/queueRetry";
import { SITE_CHAT_WHATSAPP_HREF } from "@/lib/marketing/copy";
import { createServiceModel } from "@/src/service/adapters/ai/runServiceModel";
import { beginSiteChat, finishSiteChat, linksFrom } from "@/src/service/adapters/site/siteChatRpc";
import { createServiceDataPort } from "@/src/service/adapters/supabase/serviceRpc";
import { createServiceTrace } from "@/src/service/adapters/trace/serviceTrace";
import { createServiceWallet } from "@/src/service/adapters/wallet/serviceWallet";
import { executeServiceTurn } from "@/src/service/application/executeServiceTurn";
import { SITE_CHAT_SESSION_CAP_TEXT } from "@/src/service/domain/siteChat";
import type { SiteChatLink } from "@/src/service/domain/siteChat";
import type { SitePlanCard } from "@/src/service/domain/offeringSpeech";
import type { ServiceReplyPort } from "@/src/service/ports/serviceTurnPorts";

const FAILED = "Não consegui responder agora. Tente de novo em instantes.";

export type SiteChatTurnResult =
    | { kind: "ok"; sessionId: string; reply: string; links: SiteChatLink[]; cards: SitePlanCard[]; remaining: number }
    | { kind: "session_cap"; sessionId: string; reply: string; remaining: 0 }
    | { kind: "invalid" }
    | { kind: "retry" }
    | { kind: "unavailable" };

export async function runSiteChatTurn(
    admin: SupabaseClient,
    input: { companyId: string; text: string; sessionId: string | null; reset: boolean; offeringId?: string | null }
): Promise<SiteChatTurnResult> {
    let begun;
    try {
        begun = await beginSiteChat(admin, input.companyId, input.sessionId, input.text, input.reset);
    } catch (error: unknown) {
        console.warn("[site-chat] begin", error instanceof Error ? error.message : "failed");
        return { kind: "unavailable" };
    }
    if (!begun.ok) {
        if (begun.code === "session_cap") {
            return { kind: "session_cap", sessionId: begun.sessionId, reply: SITE_CHAT_SESSION_CAP_TEXT, remaining: 0 };
        }
        if (begun.code === "not_service") return { kind: "unavailable" };
        return { kind: "invalid" };
    }

    const collected = createCollector();
    try {
        await executeServiceTurn(
            {
                admin,
                companyId: input.companyId,
                threadId: begun.sessionId,
                messageId: begun.messageId,
                phoneE164: "",
                text: input.text,
                messagingChannel: "site",
                humanHref: SITE_CHAT_WHATSAPP_HREF,
                priorTurns: begun.history,
                offeringId: input.offeringId,
            },
            {
                data: createServiceDataPort(admin),
                wallet: createServiceWallet(admin),
                model: createServiceModel(),
                reply: collected.port,
                handover: { async handoff() {} },
                trace: createServiceTrace(admin),
            }
        );
    } catch (error: unknown) {
        if (error instanceof QueueRetryableError) return { kind: "retry" };
        console.warn("[site-chat] turn", error instanceof Error ? error.message : "failed");
        return { kind: "unavailable" };
    }

    const reply = collected.reply.trim().length > 0 ? collected.reply.trim() : FAILED;
    const links = linksFrom(collected.links);
    const cards = collected.cards;
    try {
        await finishSiteChat(admin, input.companyId, begun.sessionId, reply, links, cards);
    } catch (error: unknown) {
        console.warn("[site-chat] finish", error instanceof Error ? error.message : "failed");
    }
    return { kind: "ok", sessionId: begun.sessionId, reply, links, cards, remaining: begun.remaining };
}

function createCollector(): { port: ServiceReplyPort; reply: string; links: SiteChatLink[]; cards: SitePlanCard[] } {
    const texts: string[] = [];
    const links: SiteChatLink[] = [];
    const cards: SitePlanCard[] = [];
    const bucket = { reply: "", links, cards };
    const port: ServiceReplyPort = {
        async text(body) {
            texts.push(body);
            bucket.reply = texts.filter((item) => item.trim().length > 0).join("\n\n");
        },
        async buttons(body) {
            texts.push(body);
            bucket.reply = texts.filter((item) => item.trim().length > 0).join("\n\n");
        },
        async cta(_body, label, url) {
            if (links.length >= 3 || links.some((item) => item.url === url)) return;
            links.push({ label, url });
        },
        async planCards(next) {
            cards.splice(0, cards.length, ...next.slice(0, 6));
        },
    };
    return { port, get reply() { return bucket.reply; }, links, cards };
}
