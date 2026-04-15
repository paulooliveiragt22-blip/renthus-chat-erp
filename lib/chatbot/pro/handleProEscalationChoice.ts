/**
 * Após 4× INTENT_UNKNOWN no PRO: o cliente escolhe catálogo, atendente ou tentar de novo (texto).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProcessMessageParams, Session } from "../types";
import { saveSession } from "../session";
import { botReply } from "../botSend";
import { sendFlowMessage } from "../../whatsapp/send";
import { doHandover } from "../handlers/handleMainMenu";
import { normalize } from "../utils";
import { handleProOrderIntent } from "./handleProOrderIntent";

function parseEscalationChoice(raw: string): "catalog" | "human" | "retry" | null {
    const n = normalize(raw).trim();
    if (n.length === 0) return null;
    if (/^(1|catalogo|cardapio)\b/u.test(n) || /\b(catálogo|catalogo|cardápio|cardapio)\b/u.test(n)) return "catalog";
    if (/^(2|atendente|humano|suporte)\b/u.test(n) || /\b(atendente|humano|suporte|falar\s+com)\b/u.test(n)) return "human";
    if (/^(3|tentar|novamente|continuar|texto)\b/u.test(n) || /\b(tentar\s+de\s+novo|de\s+novo|outra\s+vez)\b/u.test(n)) return "retry";
    return null;
}

export async function handleProEscalationChoice(params: {
    admin:               SupabaseClient;
    companyId:           string;
    threadId:            string;
    phoneE164:           string;
    input:               string;
    session:             Session;
    waConfig:            NonNullable<ProcessMessageParams["waConfig"]>;
    effectiveCatalogId?: string;
    companyName:         string;
    model:               string;
    profileName?:        string | null;
}): Promise<void> {
    const {
        admin, companyId, threadId, phoneE164, input, session,
        waConfig, effectiveCatalogId, companyName, model, profileName,
    } = params;

    const trimmed = input.trim();
    const choice    = parseEscalationChoice(trimmed);

    if (choice === "catalog") {
        if (!effectiveCatalogId) {
            await saveSession(admin, threadId, companyId, {
                step:    "main_menu",
                context: { ...session.context, pro_escalation_tier: 0 },
            });
            await botReply(
                admin,
                companyId,
                threadId,
                phoneE164,
                "O catálogo pelo formulário não está disponível agora. Pode mandar seu pedido em texto livre. 😊"
            );
            return;
        }
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_flow",
            context: {
                ...session.context,
                pro_escalation_tier: 0,
                flow_started_at:     new Date().toISOString(),
                flow_repeat_count:   0,
            },
        });
        await sendFlowMessage(
            phoneE164,
            {
                flowId:    effectiveCatalogId,
                flowToken: `${threadId}|${companyId}|catalog`,
                bodyText:  `Abra o catálogo do *${companyName}* para montar o pedido. 😊`,
                ctaLabel:  "Ver Catálogo",
            },
            waConfig
        );
        return;
    }

    if (choice === "human") {
        await saveSession(admin, threadId, companyId, {
            step:    "main_menu",
            context: { ...session.context, pro_escalation_tier: 0 },
        });
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // retry ou mensagem ambígua → volta ao fluxo IA (mantém pro_escalation_tier para 2º ciclo de 4 falhas)
    await saveSession(admin, threadId, companyId, {
        step:    "main_menu",
        context: {
            ...session.context,
            pro_misunderstanding_streak: 0,
        },
    });
    session.step = "main_menu";
    session.context = {
        ...session.context,
        pro_misunderstanding_streak: 0,
    };

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
        profileName,
    });
}
