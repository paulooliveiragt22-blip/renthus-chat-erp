/**
 * lib/chatbot/processMessage.ts
 *
 * Orquestrador Flow-First do chatbot.
 *
 * Fluxo:
 *   1. Verifica bot ativo + carrega config
 *   2. Ignora se step = "handover" (humano atendendo)
 *   3. detectGlobalIntents (reset por regex, detecção de nome)
 *   4. Trata step "awaiting_flow" (formulário aberto)
 *   5. classifyIntent (regex → Claude Haiku)
 *   6. Roteia por intent:
 *      - greeting / unknown  → menu de boas-vindas
 *      - order_intent        → Flow catálogo
 *      - status_intent       → Flow status ou texto
 *      - human_intent        → handover
 *      - faq                 → handleFAQ (Claude responde + oferece catálogo)
 */

export type { ProcessMessageParams } from "./types";
export type { CartItem, Session }    from "./types";

import type { ProcessMessageParams } from "./types";
import type { CompanyConfig }        from "./types";
import { getOrCreateSession, saveSession } from "./session";
import { getCompanyInfo }            from "./db/company";
import { detectGlobalIntents }       from "./middleware/intentDetector";
import { classifyIntent }            from "./middleware/intentClassifier";
import { doHandover }                from "./handlers/handleMainMenu";
import { handleFAQ }                 from "./handlers/handleFAQ";
import { replyWithOrderStatus }      from "./db/orders";
import { botReply }                  from "./botSend";
import {
    sendFlowMessage,
    sendInteractiveButtons,
} from "../whatsapp/send";
import { isWithinBusinessHours }     from "./utils";

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

export async function processInboundMessage(
    params: ProcessMessageParams
): Promise<void> {
    const { admin, companyId, threadId, waConfig, catalogFlowId, profileName } = params;
    const input = params.text.trim();
    if (!input) return;

    // ── 1. Verifica bot ativo e carrega config ────────────────────────────────
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
        name:      company?.name ?? "nossa loja",
        settings:  company?.settings ?? {},
        botConfig,
    };

    const companyName         = config.name;
    const phoneE164           = params.phoneE164;
    const effectiveCatalogId  = catalogFlowId ?? process.env.WHATSAPP_CATALOG_FLOW_ID;
    const statusFlowId        = process.env.WHATSAPP_STATUS_FLOW_ID;
    const model               = String(botConfig.model ?? "claude-haiku-4-5-20251001");

    // ── 2. Silencia quando humano está atendendo ──────────────────────────────
    if (session.step === "handover") return;

    // ── 3. Intenções globais por regex (reset, nome) ──────────────────────────
    const detected = await detectGlobalIntents(params, session, config);
    if (detected.handled) return;

    // ── 4. awaiting_flow — formulário aberto ─────────────────────────────────
    if (session.step === "awaiting_flow") {
        await handleAwaitingFlow(params, session, config, effectiveCatalogId);
        return;
    }

    // ── 5. Classifica intenção ────────────────────────────────────────────────
    const intent = await classifyIntent(input, session.step, model);

    // ── 6. Rota por intenção ──────────────────────────────────────────────────
    switch (intent) {

        case "greeting":
        case "unknown":
            await sendWelcomeMenu(params, session, config);
            break;

        case "order_intent":
            if (effectiveCatalogId) {
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
                // Fallback sem Flow configurado
                await sendWelcomeMenu(params, session, config);
            }
            break;

        case "status_intent":
            if (statusFlowId) {
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

// ─── Menu de boas-vindas ──────────────────────────────────────────────────────

async function sendWelcomeMenu(
    params: ProcessMessageParams,
    session: { step: string; context: Record<string, unknown> },
    config: CompanyConfig
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, waConfig } = params;
    const companyName = config.name;
    const settings    = config.settings;

    // Verifica horário de funcionamento
    if (!isWithinBusinessHours(settings)) {
        const msg = (settings?.closed_message as string) ??
            "Olá! No momento estamos fechados. Volte em breve. 😊";
        await botReply(admin, companyId, threadId, phoneE164, msg);
        return;
    }

    await saveSession(admin, threadId, companyId, { step: "main_menu" });

    // Saudação personalizada se cliente já conhecido
    const phoneClean = phoneE164.replaceAll(/\D/g, "");
    const { data: customer } = await admin
        .from("customers")
        .select("id, name")
        .eq("company_id", companyId)
        .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
        .limit(1)
        .maybeSingle();

    const isFirstMessage = session.step === "welcome";
    const greetText = isFirstMessage
        ? (customer?.name
            ? `Olá, *${(customer.name as string).trim()}*! 🍺\n\nComo posso te ajudar?`
            : `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\nComo posso te ajudar?`)
        : `Como posso te ajudar no *${companyName}*? 🍺`;

    await sendInteractiveButtons(
        phoneE164,
        greetText,
        [
            { id: "btn_catalog", title: "🛒 Ver Catálogo" },
            { id: "btn_status",  title: "📦 Meu pedido" },
            { id: "btn_support", title: "🙋 Falar c/ atendente" },
        ],
        waConfig
    );
}

// ─── Awaiting Flow ────────────────────────────────────────────────────────────

async function handleAwaitingFlow(
    params: ProcessMessageParams,
    session: { step: string; context: Record<string, unknown> },
    config: CompanyConfig,
    catalogFlowId: string | undefined
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, waConfig } = params;

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
                { id: "btn_status",  title: "📦 Meu pedido" },
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
