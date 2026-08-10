import { generateText, Output } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Intent, IntentDecision, PipelineContext } from "@/src/types/contracts";
import { isOrderSessionContinuityNeeded } from "@/src/pro/pipeline/sessionOrderContext";
import type { IntentService, IntentServiceInput } from "./intent.types";
import { getConfiguredLlmProviderName, resolveLanguageModel } from "@/src/pro/adapters/ai/modelProvider";
import { hasLlmApiKey } from "@/src/pro/adapters/llm/llmText";

/**
 * Labels aceitos pelo classificador — mesma união de `Intent`. `Output.choice`
 * (ai@6, substitui `generateObject`, marcado @deprecated nesta versão a favor
 * de `generateText({ output })`) garante que o modelo só pode devolver um
 * destes valores; não há mais parsing de texto livre nem `fromLlmLabel`.
 */
const INTENT_LABELS: readonly Intent[] = [
    "order_intent",
    "status_intent",
    "human_intent",
    "faq",
    "greeting",
    "unknown",
];

const BTN_CATALOG = new Set(["btn_catalog"]);
const BTN_ORDER = new Set(["btn_order"]);
const BTN_STATUS = new Set(["btn_status"]);
const BTN_SUPPORT = new Set(["btn_support"]);
const BTN_ORDER_EDIT = new Set(["pro_edit_order", "btn_edit_order"]);
const BTN_ORDER_ADD_MORE = new Set(["pro_add_items", "btn_add_items"]);
const BTN_ORDER_CANCEL = new Set(["pro_cancel_order", "btn_cancel_order"]);
const BTN_ORDER_CONFIRM = new Set(["pro_confirm_order", "btn_confirm_order", "confirmar_pedido", "confirm_order"]);
const BTN_PAY = new Set(["pro_pay_pix", "pro_pay_card", "pro_pay_cash"]);
const BTN_CONFIRM_ADDRESS = new Set([
    "pro_confirm_saved_address",
    "pro_confirm_typed_address",
    "pro_edit_delivery_address",
    "pro_new_address_flow",
]);

const HUMAN_RE = /\b(?:atendente|humano|suporte|falar\s+com)\b/iu;
const STATUS_RE = /\b(?:status|cad[eê]|onde\s+est[aá]|acompanhar|previs[aã]o)\b/iu;
const ORDER_RE = /\b(?:quero|pedir|comprar|card[aá]pio|cat[aá]logo|bebida|adicionar)\b/iu;
const FAQ_RE = /\b(?:qual|quanto|como|onde|quando|aceita|entrega|funciona|tem)\b/iu;
/**
 * Ancorada (mensagem toda = saudação) para não capturar "oi" no meio de frase.
 * `+` nas vogais finais cobre variações coloquiais comuns no WhatsApp
 * ("oii", "oiii", "olaa", "opaa") — sem isso, "oii" caía no LLM e, se o
 * provider falhasse, o cliente recebia o erro genérico em vez do menu.
 */
const GREETING_RE =
    /^(?:oi+|ol[aá]+|opa+|al[oô]+|e\s*a[ií]+|eae+|bom\s+dia|boa\s+tarde|boa\s+noite|salve+|hey+|hello+)\W*$/iu;

const CONFIRM_RE =
    /^(?:sim|ok|confirmo|confirmar|pode\s+confirmar|pode\s+fechar|fechar|confirmar_pedido|confirm_order)\b/iu;
const REJECT_RE = /^(?:n[aã]o|nao|cancelar|cancela)\b/iu;

function normalize(text: string): string {
    return text.trim().toLowerCase();
}

function llmLanguageEnabled(context: PipelineContext): boolean {
    return context.policies.llmEnabled !== false;
}

/** Extrai texto curto de entradas recentes do utilizador no histórico da IA (para contexto do classificador). */
function recentUserUtterancesForIntent(session: PipelineContext["session"], maxLines: number, maxChars: number): string {
    const lines: string[] = [];
    for (let i = session.aiHistory.length - 1; i >= 0 && lines.length < maxLines; i--) {
        const turn = session.aiHistory[i];
        if (turn?.role !== "user") continue;
        const c = turn.content;
        let text = "";
        if (typeof c === "string") {
            text = c;
        } else if (c != null && typeof c === "object" && "text" in c && typeof (c as { text?: unknown }).text === "string") {
            text = String((c as { text: string }).text);
        }
        const t = text.replaceAll(/\s+/gu, " ").trim();
        if (t) lines.unshift(t.length > maxChars ? `${t.slice(0, maxChars)}…` : t);
    }
    return lines.join(" | ");
}

/** Resumo mínimo da sessão PRO para o Haiku não classificar pedido como greeting sem contexto. */
function buildIntentClassifierContextBlock(session: PipelineContext["session"]): string {
    const d = session.draft;
    const parts: string[] = [`step=${session.step}`];
    if (d?.items?.length) {
        const first = d.items[0]?.productName ?? "?";
        parts.push(
            `draft_items=${d.items.length} (ex.: ${first.slice(0, 40)}), draft_address=${d.address ? "yes" : "no"}, draft_payment=${d.paymentMethod ?? "none"}`
        );
    } else {
        parts.push("draft_items=0");
    }
    const recent = recentUserUtterancesForIntent(session, 4, 120);
    if (recent) parts.push(`recent_user=${recent}`);
    return parts.join("\n");
}

async function llmClassify(
    context: PipelineContext,
    userText: string,
    admin?: SupabaseClient
): Promise<IntentDecision> {
    if (!hasLlmApiKey(context.policies.aiProvider)) {
        return { intent: "unknown", confidence: "low", reasonCode: "fallback_unknown" };
    }

    try {
        const sessionBlock = buildIntentClassifierContextBlock(context.session);
        const userPayload =
            `Contexto da sessão (use para desambiguar respostas curtas como quantidade ou "sim"):\n${sessionBlock}\n\n` +
            `Mensagem actual do cliente a classificar:\n---\n${userText.trim()}\n---`;

        const result = await generateText({
            model: resolveLanguageModel({ provider: context.policies.aiProvider, model: context.policies.aiModel }),
            system:
                "Classify the client's CURRENT message for a Brazilian WhatsApp delivery assistant. " +
                "If the session shows an active order (draft with items, or recent user messages about products) " +
                "and the current message is a short reply (quantity, packaging, confirmation), prefer order_intent. " +
                "Availability questions (tem coca?, vocês vendem X?, quanto custa?) → faq (NOT order_intent). " +
                "Greetings (oi, bom dia) → greeting. Ask for human → human_intent.",
            prompt: userPayload,
            output: Output.choice({ options: [...INTENT_LABELS] }),
            maxRetries: 2,
            abortSignal: AbortSignal.timeout(12_000),
        });

        if (admin) {
            try {
                const { debitFromAnthropicUsage } = await import("@/lib/billing/aiWallet");
                await debitFromAnthropicUsage(
                    admin,
                    context.tenant.companyId,
                    {
                        input_tokens: result.usage.inputTokens ?? 0,
                        output_tokens: result.usage.outputTokens ?? 0,
                    },
                    {
                        source: "pro_intent_classifier",
                        provider: context.policies.aiProvider ?? getConfiguredLlmProviderName(),
                        model: result.response.modelId?.trim() || "unknown",
                    }
                );
            } catch {
                /* billing best-effort */
            }
        }

        const mapped = result.output;
        return {
            intent: mapped,
            confidence: mapped === "unknown" ? "low" : "medium",
            reasonCode: "llm_classification",
        };
    } catch {
        return { intent: "unknown", confidence: "low", reasonCode: "fallback_unknown" };
    }
}

/** Regex de linguagem — só no degradado (IA off / sem crédito / limite). */
function classifyWithLanguageRegex(raw: string): IntentDecision | null {
    if (HUMAN_RE.test(raw)) return { intent: "human_intent", confidence: "high", reasonCode: "regex_match" };
    if (STATUS_RE.test(raw)) return { intent: "status_intent", confidence: "high", reasonCode: "regex_match" };
    if (GREETING_RE.test(raw)) return { intent: "greeting", confidence: "high", reasonCode: "regex_match" };
    if (ORDER_RE.test(raw)) return { intent: "order_intent", confidence: "medium", reasonCode: "regex_match" };
    if (FAQ_RE.test(raw)) return { intent: "faq", confidence: "medium", reasonCode: "regex_match" };
    return null;
}

export class ProIntentClassifierService implements IntentService {
    constructor(private readonly admin?: SupabaseClient) {}

    async classify(input: IntentServiceInput): Promise<IntentDecision> {
        const { context, userText } = input;
        const raw = userText.trim();
        const text = normalize(userText);
        const useLlm = llmLanguageEnabled(context);

        // Camada 1: IDs de botão e atalhos de confirmação (não são interpretação de linguagem livre)
        if (context.session.step === "pro_awaiting_confirmation" && (CONFIRM_RE.test(raw) || REJECT_RE.test(raw))) {
            return { intent: "order_intent", confidence: "high", reasonCode: "confirmation_shortcut" };
        }
        if (
            BTN_ORDER_EDIT.has(text) ||
            BTN_ORDER_ADD_MORE.has(text) ||
            BTN_ORDER_CANCEL.has(text) ||
            BTN_ORDER_CONFIRM.has(text) ||
            BTN_PAY.has(text) ||
            BTN_CONFIRM_ADDRESS.has(text)
        ) {
            return { intent: "order_intent", confidence: "high", reasonCode: "button_id_match" };
        }
        if (BTN_CATALOG.has(text) || BTN_ORDER.has(text)) {
            return { intent: "order_intent", confidence: "high", reasonCode: "button_id_match" };
        }
        if (BTN_STATUS.has(text)) return { intent: "status_intent", confidence: "high", reasonCode: "button_id_match" };
        if (BTN_SUPPORT.has(text)) return { intent: "human_intent", confidence: "high", reasonCode: "button_id_match" };
        /**
         * Em escolha de escalação, o LLM classifica "cartão"/"pix" como human_intent (ruído).
         * Palavra isolada de pagamento continua no fluxo de pedido.
         */
        if (context.session.step === "pro_escalation_choice") {
            const payNorm = raw
                .trim()
                .toLowerCase()
                .normalize("NFD")
                .replaceAll(/\p{Diacritic}/gu, "")
                .replaceAll(/\s+/g, " ");
            if (/^(pix|cartao|dinheiro|especie|card|cash|credito|debito)$/u.test(payNorm)) {
                return { intent: "order_intent", confidence: "high", reasonCode: "regex_match" };
            }
        }

        // Pedido em curso: respostas curtas não reabrem menu (mesmo com LLM ligado).
        if (isOrderSessionContinuityNeeded(context.session)) {
            if (STATUS_RE.test(raw)) {
                return { intent: "status_intent", confidence: "high", reasonCode: "active_order_session" };
            }
            /**
             * "oi" com lastSearchPicks residual (sem itens no draft) não é pick —
             * trata como greeting para soft-reset da UI de clarificação.
             */
            if (GREETING_RE.test(raw) && !(context.session.draft?.items?.length)) {
                return { intent: "greeting", confidence: "high", reasonCode: "regex_match" };
            }
            if (!useLlm) {
                return { intent: "order_intent", confidence: "high", reasonCode: "active_order_session" };
            }
            // Curtas ("2", "uma caixa") → pedido; frases longas → LLM.
            if (raw.length <= 48 && !HUMAN_RE.test(raw)) {
                return { intent: "order_intent", confidence: "high", reasonCode: "active_order_session" };
            }
            return llmClassify(context, userText, this.admin);
        }

        /**
         * Saudação nunca depende de IA: detecção por regex (alta confiança, sem ambiguidade) +
         * `routeStage.ts` responde com o menu de boas-vindas via `direct_reply`, sem chamar o LLM
         * em nenhuma etapa. Cobre tanto o degradado (`!useLlm`) quanto o caminho normal — evita que
         * uma falha do provider (chave ausente/inválida, rate limit) prejudique a mensagem mais
         * comum e mais simples do fluxo inteiro.
         */
        if (GREETING_RE.test(raw)) {
            return { intent: "greeting", confidence: "high", reasonCode: "regex_match" };
        }

        // Degradado: regex de linguagem. Com crédito/IA: sempre LLM desde a 1ª mensagem.
        if (!useLlm) {
            const byRegex = classifyWithLanguageRegex(raw);
            if (byRegex) return byRegex;
            return { intent: "unknown", confidence: "low", reasonCode: "fallback_unknown" };
        }

        return llmClassify(context, userText, this.admin);
    }
}
