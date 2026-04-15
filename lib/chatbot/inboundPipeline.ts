/**
 * Pipeline único de mensagens inbound do chatbot.
 * Ramifica por plano: Starter (flow-first actual) vs PRO (IA + tool + Flow após falhas).
 */

import type { ProcessMessageParams, CompanyConfig } from "./types";
import type { ChatbotProductTier } from "./tier";
import { getOrCreateSession, saveSession } from "./session";
import { getCompanyInfo } from "./db/company";
import { detectGlobalIntents } from "./middleware/intentDetector";
import { classifyIntent } from "./middleware/intentClassifier";
import { doHandover } from "./handlers/handleMainMenu";
import { handleFAQ } from "./handlers/handleFAQ";
import { replyWithOrderStatus } from "./db/orders";
import { botReply } from "./botSend";
import { sendFlowMessage, sendInteractiveButtons } from "../whatsapp/send";
import { clampChatbotInputForRegex, isWithinBusinessHours } from "./utils";
import { handleProOrderIntent } from "./pro/handleProOrderIntent";
import { handleProEscalationChoice } from "./pro/handleProEscalationChoice";
import type { AiOrderCanonicalDraft } from "./pro/typesAiOrder";

export async function runInboundChatbotPipeline(
    params: ProcessMessageParams,
    tier: ChatbotProductTier
): Promise<void> {
    const { admin, companyId, threadId, waConfig, catalogFlowId } = params;
    const input = clampChatbotInputForRegex(params.text.trim());
    if (!input) return;

    const { data: botRows } = await admin
        .from("chatbots")
        .select("id, config")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

    if (!botRows?.length) {
        console.warn("[chatbot] Nenhum chatbot ativo para company:", companyId);
        return;
    }

    const botConfig = (botRows[0]?.config as Record<string, unknown>) ?? {};
    const [company, session] = await Promise.all([
        getCompanyInfo(admin, companyId),
        getOrCreateSession(admin, threadId, companyId),
    ]);

    const config: CompanyConfig = {
        name:     company?.name ?? "nossa loja",
        settings: company?.settings ?? {},
        botConfig,
    };

    const companyName        = config.name;
    const phoneE164          = params.phoneE164;
    const effectiveCatalogId = catalogFlowId ?? process.env.WHATSAPP_CATALOG_FLOW_ID;
    const statusFlowId       = process.env.WHATSAPP_STATUS_FLOW_ID;
    const model              = String(botConfig.model ?? "claude-haiku-4-5-20251001");

    if (session.step === "handover") return;

    const detected = await detectGlobalIntents({ ...params, text: input }, session, config);
    if (detected.handled) return;

    if (session.step === "awaiting_flow") {
        await handleAwaitingFlow({ ...params, text: input }, session);
        return;
    }

    if (tier === "pro" && session.step === "pro_escalation_choice" && waConfig) {
        await handleProEscalationChoice({
            admin,
            companyId,
            threadId,
            phoneE164,
            input,
            session,
            waConfig,
            effectiveCatalogId,
            companyName,
            model,
            profileName: params.profileName,
        });
        return;
    }

    const draftForIntent = session.context.ai_order_canonical as AiOrderCanonicalDraft | undefined;
    const intent         = await classifyIntent(input, session.step, model, {
        orderConfirmationPending: tier === "pro" && Boolean(draftForIntent?.pending_confirmation),
    });

    switch (intent) {
        case "greeting":
        case "unknown":
            await sendWelcomeMenu(params, session, config, tier);
            break;

        case "order_intent":
            if (tier === "pro" && waConfig) {
                await handleProOrderIntent({
                    admin,
                    companyId,
                    threadId,
                    phoneE164,
                    input,
                    session,
                    effectiveCatalogId,
                    companyName,
                    model,
                    waConfig,
                    profileName: params.profileName,
                });
            } else {
                await starterOrderFlow(params, session, config, effectiveCatalogId, companyName);
            }
            break;

        case "status_intent":
            if (statusFlowId && waConfig) {
                await sendFlowMessage(
                    phoneE164,
                    {
                        flowId:    statusFlowId,
                        flowToken: `${threadId}|${companyId}|status`,
                        bodyText:  "Consulte o status do seu pedido:",
                        ctaLabel:  "Ver Status",
                    },
                    waConfig
                );
            } else {
                await replyWithOrderStatus(admin, companyId, threadId, phoneE164);
            }
            break;

        case "human_intent":
            await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
            break;

        case "faq":
            await handleFAQ(params, session, config);
            break;
    }

}

async function starterOrderFlow(
    params: ProcessMessageParams,
    session: { step: string; context: Record<string, unknown> },
    config: CompanyConfig,
    effectiveCatalogId: string | undefined,
    companyName: string
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, waConfig } = params;
    if (effectiveCatalogId && waConfig) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_flow",
            context: {
                ...session.context,
                flow_started_at:   new Date().toISOString(),
                flow_repeat_count: 0,
            },
        });
        await sendFlowMessage(
            phoneE164,
            {
                flowId:    effectiveCatalogId,
                flowToken: `${threadId}|${companyId}|catalog`,
                bodyText:  `🛒 Escolha o que você quer pedir no *${companyName}*!`,
                ctaLabel:  "Ver Catálogo",
            },
            waConfig
        );
    } else {
        await sendWelcomeMenu(params, session, config, "starter");
    }
}

function applyProGreetingTemplate(
    tpl: string,
    companyName: string,
    customerName: string | null
): string {
    const nome = (customerName ?? "").trim() || "Cliente";
    return tpl
        .replaceAll("{empresa}", companyName)
        .replaceAll("{nome}", nome);
}

async function sendWelcomeMenu(
    params: ProcessMessageParams,
    session: { step: string; context: Record<string, unknown> },
    config: CompanyConfig,
    tier: ChatbotProductTier
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, waConfig } = params;
    if (!waConfig) {
        console.warn("[chatbot] sendWelcomeMenu: waConfig ausente");
        return;
    }
    const companyName = config.name;
    const settings    = config.settings;
    const botCfg      = config.botConfig;

    if (!isWithinBusinessHours(settings)) {
        const msg = (settings?.closed_message as string) ??
            "Olá! No momento estamos fechados. Volte em breve. 😊";
        await botReply(admin, companyId, threadId, phoneE164, msg);
        return;
    }

    await saveSession(admin, threadId, companyId, { step: "main_menu" });

    const phoneClean = phoneE164.replaceAll(/\D/g, "");
    const { data: customer } = await admin
        .from("customers")
        .select("id, name")
        .eq("company_id", companyId)
        .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
        .limit(1)
        .maybeSingle();

    const isFirstMessage = session.step === "welcome";
    let greetText: string;

    if (tier === "pro") {
        const firstTpl   = String(botCfg.pro_greeting_first_contact ?? "").trim();
        const routineTpl = String(botCfg.pro_greeting_routine ?? "").trim();
        const hasCustomerRow = Boolean(customer?.id);
        if (!hasCustomerRow) {
            greetText = firstTpl
                ? applyProGreetingTemplate(firstTpl, companyName, null)
                : `Olá! É seu primeiro contato com a *${companyName}* por aqui. 🍺\n\nPode mandar seu pedido em texto livre (bebidas, quantidades, endereço e pagamento).`;
        } else {
            const nm = customer?.name ? String(customer.name).trim() : null;
            greetText = routineTpl
                ? applyProGreetingTemplate(routineTpl, companyName, nm)
                : nm
                    ? `Olá, *${nm}*! Que bom te ver de novo no *${companyName}*. 🍺\n\nDiz o que pedimos hoje em texto livre.`
                    : `Olá de novo! No *${companyName}*, o que pedimos hoje? 🍺`;
        }
        await botReply(admin, companyId, threadId, phoneE164, greetText);
        return;
    } else if (!isFirstMessage) {
        greetText = `Como posso te ajudar no *${companyName}*? 🍺`;
    } else if (customer?.name) {
        greetText = `Olá, *${(customer.name as string).trim()}*! 🍺\n\nComo posso te ajudar?`;
    } else {
        greetText = `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\nComo posso te ajudar?`;
    }

    await sendInteractiveButtons(
        phoneE164,
        greetText,
        [
            { id: "btn_catalog", title: "🛒 Ver Catálogo" },
            { id: "btn_status", title: "📦 Meu pedido" },
            { id: "btn_support", title: "🙋 Falar c/ atendente" },
        ],
        waConfig
    );
}

async function handleAwaitingFlow(
    params: ProcessMessageParams,
    session: { step: string; context: Record<string, unknown> }
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, waConfig } = params;
    if (!waConfig) {
        console.warn("[chatbot] handleAwaitingFlow: waConfig ausente");
        return;
    }

    const FLOW_ESCAPE_RE  = /\b(?:cancelar|sair|voltar|menu|oi|ola)\b/iu;
    const flowStartedAt   = session.context.flow_started_at as string | undefined;
    const flowRepeatCount = ((session.context.flow_repeat_count as number) ?? 0);
    const flowExpired     = flowStartedAt
        ? Date.now() - new Date(flowStartedAt).getTime() > 5 * 60 * 1000
        : false;
    const flowStuck = flowRepeatCount >= 3;

    if (FLOW_ESCAPE_RE.test(params.text.trim()) || flowExpired || flowStuck) {
        await saveSession(admin, threadId, companyId, {
            step:    "main_menu",
            context: {
                ...session.context,
                flow_token:        undefined,
                flow_started_at:   undefined,
                flow_repeat_count: undefined,
            },
        });
        const reason = flowStuck
            ? "O formulário expirou, vamos recomeçar. 😊"
            : "Formulário cancelado. Como posso te ajudar?";

        await sendInteractiveButtons(
            phoneE164,
            reason,
            [
                { id: "btn_catalog", title: "🛒 Ver Catálogo" },
                { id: "btn_status", title: "📦 Meu pedido" },
                { id: "btn_support", title: "🙋 Falar c/ atendente" },
            ],
            waConfig
        );
    } else {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, flow_repeat_count: flowRepeatCount + 1 },
        });
        await botReply(
            admin, companyId, threadId, phoneE164,
            "Você tem um formulário aberto. Preencha-o pelo botão acima ou diga *cancelar* para voltar. 😊"
        );
    }

}
