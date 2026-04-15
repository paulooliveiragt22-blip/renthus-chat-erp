import Anthropic from "@anthropic-ai/sdk";
import type { Intent, IntentDecision, PipelineContext } from "@/src/types/contracts";
import type { IntentService, IntentServiceInput } from "./intent.types";

const BTN_CATALOG = new Set(["btn_catalog", "1"]);
const BTN_STATUS = new Set(["btn_status", "2"]);
const BTN_SUPPORT = new Set(["btn_support", "3"]);

const HUMAN_RE = /\b(?:atendente|humano|suporte|falar\s+com)\b/iu;
const STATUS_RE = /\b(?:status|cad[eê]|onde\s+est[aá]|acompanhar|previs[aã]o)\b/iu;
const ORDER_RE = /\b(?:quero|pedir|comprar|card[aá]pio|cat[aá]logo|bebida|adicionar)\b/iu;
const FAQ_RE = /\b(?:qual|quanto|como|onde|quando|aceita|entrega|funciona)\b/iu;
const GREETING_RE = /^(?:oi|ol[aá]|bom dia|boa tarde|boa noite|e ai|e aí)\W*$/iu;

const CONFIRM_RE = /^(?:sim|ok|confirmo|pode\s+fechar|fechar)\b/iu;
const REJECT_RE = /^(?:n[aã]o|nao|cancelar|cancela)\b/iu;

function normalize(text: string): string {
    return text.trim().toLowerCase();
}

function fromLlmLabel(label: string): Intent | null {
    const v = label.trim().toLowerCase();
    if (v === "order_intent") return "order_intent";
    if (v === "status_intent") return "status_intent";
    if (v === "human_intent") return "human_intent";
    if (v === "faq") return "faq";
    if (v === "greeting") return "greeting";
    if (v === "unknown") return "unknown";
    return null;
}

async function llmClassify(context: PipelineContext, userText: string): Promise<IntentDecision> {
    if (!process.env.ANTHROPIC_API_KEY) {
        return { intent: "unknown", confidence: "low", reasonCode: "fallback_unknown" };
    }

    try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const resp = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 12,
            system:
                "Classify a WhatsApp user message into exactly one label: " +
                "order_intent, status_intent, human_intent, faq, greeting, unknown. " +
                "Reply only with the label.",
            messages: [{ role: "user", content: userText }],
        });
        const text = (resp.content[0] as { text?: string } | undefined)?.text ?? "";
        const mapped = fromLlmLabel(text);
        if (!mapped) return { intent: "unknown", confidence: "low", reasonCode: "fallback_unknown" };
        return {
            intent: mapped,
            confidence: mapped === "unknown" ? "low" : "medium",
            reasonCode: "llm_classification",
        };
    } catch {
        return { intent: "unknown", confidence: "low", reasonCode: "fallback_unknown" };
    }
}

export class ProIntentClassifierService implements IntentService {
    async classify(input: IntentServiceInput): Promise<IntentDecision> {
        const { context, userText } = input;
        const raw = userText.trim();
        const text = normalize(userText);

        // Camada 1: contexto e sinais determinísticos
        if (context.session.step === "pro_awaiting_confirmation" && (CONFIRM_RE.test(raw) || REJECT_RE.test(raw))) {
            return { intent: "order_intent", confidence: "high", reasonCode: "confirmation_shortcut" };
        }
        if (BTN_CATALOG.has(text)) return { intent: "order_intent", confidence: "high", reasonCode: "button_id_match" };
        if (BTN_STATUS.has(text)) return { intent: "status_intent", confidence: "high", reasonCode: "button_id_match" };
        if (BTN_SUPPORT.has(text)) return { intent: "human_intent", confidence: "high", reasonCode: "button_id_match" };
        if (HUMAN_RE.test(raw)) return { intent: "human_intent", confidence: "high", reasonCode: "regex_match" };

        // Camada 2: regex curta de alta precisão
        if (STATUS_RE.test(raw)) return { intent: "status_intent", confidence: "high", reasonCode: "regex_match" };
        if (GREETING_RE.test(raw)) return { intent: "greeting", confidence: "high", reasonCode: "regex_match" };
        if (ORDER_RE.test(raw)) return { intent: "order_intent", confidence: "medium", reasonCode: "regex_match" };
        if (FAQ_RE.test(raw)) return { intent: "faq", confidence: "medium", reasonCode: "regex_match" };

        // Camada 3: IA no ambíguo
        return llmClassify(context, userText);
    }
}

