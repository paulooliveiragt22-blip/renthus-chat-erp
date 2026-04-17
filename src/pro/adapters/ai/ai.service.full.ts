import Anthropic from "@anthropic-ai/sdk";
import { runWithAnthropicInFlightSlot } from "@/lib/chatbot/anthropicInFlightGate";
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    AiServiceInput,
    AiServiceResult,
    AiTurn,
    OrderDraft,
} from "@/src/types/contracts";
import type { AiService } from "../../services/ai/ai.types";
import { runSearchProdutos } from "@/lib/chatbot/pro/searchProdutos";
import { buildOrderHintsPayload } from "@/lib/chatbot/pro/orderHints";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import {
    buildPrepareDraftGuidanceForModel,
    prepareOrderDraftFromTool,
} from "@/lib/chatbot/pro/prepareOrderDraft";
import { toCanonicalDraft } from "@/src/types/contracts.adapters";
import type { PrepareDraftToolInputLegacy } from "@/src/types/contracts.legacy";
import { stripHallucinatedOrderPersistenceClaims } from "./sanitizeAiVisibleOrderClaims";
import { isDraftStructurallyCompleteForFinalize } from "@/src/pro/pipeline/orderDraftGate";

type ToolName = "search_produtos" | "get_order_hints" | "prepare_order_draft";
type IntentMarker = "ok" | "unknown" | null;
type AnthropicMessage = { role: "user" | "assistant"; content: unknown };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
const AI_TIMEOUT_CODE = "AI_TIMEOUT";

const SEARCH_TOOL = {
    name: "search_produtos",
    description:
        "Busca catálogo real da empresa por nome/termo/categoria. A resposta inclui guidance_for_model_pt — siga quando items estiver vazio.",
    input_schema: {
        type: "object" as const,
        properties: {
            query: { type: "string" },
            category_hint: { type: "string" },
        },
        required: [],
    },
};

const HINTS_TOOL = {
    name: "get_order_hints",
    description: "Retorna endereços salvos e favoritos do cliente.",
    input_schema: {
        type: "object" as const,
        properties: {},
    },
};

const PREPARE_DRAFT_TOOL = {
    name: "prepare_order_draft",
    description:
        "Valida item/endereço/pagamento no servidor e devolve rascunho canônico com totais e erros. Sempre leia guidance_for_model_pt na resposta antes de escrever para o cliente.",
    input_schema: {
        type: "object" as const,
        properties: {
            items: { type: "array" },
            address: { type: "object" },
            address_raw: { type: "string" },
            saved_address_id: { type: "string" },
            use_saved_address: { type: "boolean" },
            payment_method: { type: "string" },
            change_for: { type: "number" },
            ready_for_confirmation: { type: "boolean" },
        },
        required: ["items"],
    },
};

const SYSTEM_PROMPT = `Você é o assistente PRO de delivery.
- Fale PT-BR direto.
- Fonte de verdade: só cite produto, preço, estoque e totais vindos dos JSONs das tools (search_produtos, get_order_hints, prepare_order_draft). Nunca invente.
- Ordem recomendada: get_order_hints cedo; search_produtos antes de cada produto novo; prepare_order_draft pode ser repetido até ok:true (cliente pode mandar produto, endereço e pagamento em qualquer ordem — você monta o próximo prepare com o que já souber).
- Após prepare_order_draft: se ok:false, sua mensagem DEVE refletir as errors e o guidance_for_model_pt (sem “erro técnico genérico” quando a causa for validação). Se ok:true, alinhe o texto ao draft.
- Se search_produtos retornar items vazio, não invente produto nem preço; siga guidance_for_model_pt.
- Só peça confirmação explícita de pedido fechado quando o draft do servidor estiver completo e pendente de confirmação.
- Nunca diga que o pedido já foi confirmado, criado no sistema, registrado na loja ou que saiu para entrega: isso só ocorre após confirmação no servidor (fora do modelo).
- Termine a resposta com:
  - INTENT_OK quando houve progresso de pedido
  - INTENT_UNKNOWN quando não houve progresso`;

function stripIntentMarker(text: string): { visible: string; marker: "ok" | "unknown" | null } {
    const t = text.trimEnd();
    if (t.endsWith("INTENT_OK")) return { visible: t.replace(/INTENT_OK\s*$/u, "").trimEnd(), marker: "ok" };
    if (t.endsWith("INTENT_UNKNOWN")) return { visible: t.replace(/INTENT_UNKNOWN\s*$/u, "").trimEnd(), marker: "unknown" };
    return { visible: t.trim(), marker: null };
}

/** Evita contradicao: modelo fala em “erro” mas o draft (BD/tools) ja tem itens validos. */
function sanitizeVisibleAgainstDraft(visible: string, draft: OrderDraft | null): string {
    if (!draft) return visible;
    const items = draft.items;
    if (!items.length) return visible;

    const flat = visible
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");

    const failureHints = [
        "erro tecnico",
        "erro ao buscar",
        "tive um erro",
        "nao consegui",
        "falha ao buscar",
        "falha ao",
        "problema tecnico",
        "dificuldade",
        "nao encontrei o produto",
        "nao encontrei",
        "nao foi possivel",
        "infelizmente",
    ];
    const looksLikeFailure = failureHints.some((h) => flat.includes(h));
    if (!looksLikeFailure) return visible;

    const lines = items.map((it) => {
        const name = it.productName ?? "Item";
        const sub = it.quantity * it.unitPrice;
        return `• ${it.quantity}x ${name} — R$ ${sub.toFixed(2).replace(".", ",")}`;
    });
    const totalFromDraft =
        draft.grandTotal ?? items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
    let msg =
        `Certo! Segue o que esta no seu pedido (cadastro da loja):\n${lines.join("\n")}\n` +
        `Total estimado: R$ ${totalFromDraft.toFixed(2).replace(".", ",")}.\n\n`;
    if (draft.paymentMethod) {
        msg += "Revise os dados e confirme o pedido quando estiver tudo certo.";
    } else {
        msg +=
            "Confirme o endereco (use o botao abaixo ou digite o endereco completo) e diga se paga em PIX, cartao ou dinheiro.";
    }
    return msg.trim();
}

function toAnthropicMessages(history: AiTurn[]): Array<{ role: "user" | "assistant"; content: unknown }> {
    return history
        .slice(-24)
        .map((h) => ({ role: h.role, content: h.content }));
}

function shouldEscalate(input: AiServiceInput, marker: IntentMarker): boolean {
    const streak = input.context.session.misunderstandingStreak;
    if (marker === "ok") return false;
    if (input.intentDecision.intent === "human_intent") return true;
    return streak + 1 >= input.context.policies.escalationRule.unknownConsecutive;
}

function isTimeoutError(error: unknown): boolean {
    if (error instanceof Error && error.name === "AbortError") return true;
    if (!error || typeof error !== "object") return false;
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
    const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    return message.includes(AI_TIMEOUT_CODE) || code === AI_TIMEOUT_CODE;
}

function isRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const e = error as { status?: number; message?: unknown };
    if (e.status === 429) return true;
    const m = String(e.message ?? "").toLowerCase();
    return m.includes("429") || m.includes("rate limit") || m.includes("too many requests");
}

export class FullAiServiceAdapter implements AiService {
    constructor(private readonly admin: SupabaseClient) {}

    private async callModel(client: Anthropic, messages: AnthropicMessage[], timeoutMs: number) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(AI_TIMEOUT_CODE), Math.max(timeoutMs, 1000));
        try {
            return await runWithAnthropicInFlightSlot(() =>
                client.messages.create(
                    {
                        model: "claude-haiku-4-5-20251001",
                        max_tokens: 900,
                        system: SYSTEM_PROMPT,
                        messages: messages as MessageCreateParams["messages"],
                        tools: [SEARCH_TOOL, HINTS_TOOL, PREPARE_DRAFT_TOOL] as MessageCreateParams["tools"],
                    },
                    {
                        signal: controller.signal,
                    } as never
                )
            );
        } catch (error) {
            if (controller.signal.aborted) {
                const timeoutError = new Error(AI_TIMEOUT_CODE);
                (timeoutError as { code?: string }).code = AI_TIMEOUT_CODE;
                throw timeoutError;
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private toLegacyToolInput(raw: Record<string, unknown>): PrepareDraftToolInputLegacy {
        return {
            items: (raw.items as PrepareDraftToolInputLegacy["items"]) ?? [],
            address: (raw.address as PrepareDraftToolInputLegacy["address"]) ?? null,
            address_raw: raw.address_raw == null ? null : String(raw.address_raw),
            saved_address_id: raw.saved_address_id == null ? null : String(raw.saved_address_id),
            use_saved_address: Boolean(raw.use_saved_address),
            payment_method: raw.payment_method == null ? null : String(raw.payment_method),
            change_for: raw.change_for == null ? null : Number(raw.change_for),
            ready_for_confirmation: Boolean(raw.ready_for_confirmation),
        };
    }

    private async runSearchTool(input: AiServiceInput, block: { id: string; input: unknown }): Promise<ToolResultBlock> {
        const payload = (block.input ?? {}) as Record<string, unknown>;
        const query = String(payload.query ?? "");
        const categoryHint = payload.category_hint == null ? null : String(payload.category_hint);
        const rows = await runSearchProdutos(
            this.admin,
            input.context.tenant.companyId,
            query,
            { categoryHint, limit: 8 }
        );
        const guidanceForModelPt =
            rows.length > 0
                ? ["Use apenas produto_embalagem_id desta lista em prepare_order_draft."]
                : [
                      "Nenhum item no catálogo para este termo.",
                      "Não invente nome nem preço. Peça outro termo mais curto ou categoria; opcionalmente nova busca.",
                  ];
        return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ items: rows, guidance_for_model_pt: guidanceForModelPt }),
        };
    }

    private async runHintsTool(input: AiServiceInput, block: { id: string }): Promise<ToolResultBlock> {
        const hints = await buildOrderHintsPayload({
            admin: this.admin,
            companyId: input.context.tenant.companyId,
            phoneE164: input.context.tenant.phoneE164,
            name: input.context.actor.profileName ?? null,
        });
        return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(hints),
        };
    }

    private async runPrepareDraftTool(
        input: AiServiceInput,
        block: { id: string; input: unknown },
        currentDraft: OrderDraft | null
    ): Promise<{ result: ToolResultBlock; nextDraft: OrderDraft | null }> {
        const raw = (block.input ?? {}) as Record<string, unknown>;
        const legacyInput = this.toLegacyToolInput(raw);
        let effectiveCustomerId = input.context.session.customerId;
        if (!effectiveCustomerId) {
            const c = await getOrCreateCustomer(
                this.admin,
                input.context.tenant.companyId,
                input.context.tenant.phoneE164,
                input.context.actor.profileName ?? null
            );
            effectiveCustomerId = c?.id ?? null;
        }
        const prepared = await prepareOrderDraftFromTool(
            this.admin,
            input.context.tenant.companyId,
            effectiveCustomerId,
            legacyInput
        );
        const nextDraft = prepared.draft ? toCanonicalDraft(prepared.draft) : currentDraft;
        return {
            nextDraft,
            result: {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({
                    ok: prepared.ok,
                    errors: prepared.errors,
                    has_draft: Boolean(prepared.draft),
                    guidance_for_model_pt: buildPrepareDraftGuidanceForModel(
                        prepared.ok,
                        prepared.errors
                    ),
                }),
            },
        };
    }

    private async executeToolBlock(
        input: AiServiceInput,
        block: { id: string; name: string; input: unknown },
        currentDraft: OrderDraft | null
    ): Promise<{ result: ToolResultBlock; nextDraft: OrderDraft | null }> {
        const name = block.name as ToolName;
        if (name === "search_produtos") {
            return { result: await this.runSearchTool(input, block), nextDraft: currentDraft };
        }
        if (name === "get_order_hints") {
            return { result: await this.runHintsTool(input, block), nextDraft: currentDraft };
        }
        if (name === "prepare_order_draft") {
            const out = await this.runPrepareDraftTool(input, block, currentDraft);
            return { result: out.result, nextDraft: out.nextDraft };
        }
        return {
            result: {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({ ok: false, error: "unsupported_tool", tool: block.name }),
            },
            nextDraft: currentDraft,
        };
    }

    private async executeToolRound(
        input: AiServiceInput,
        content: Array<{ type: string; id?: string; name?: string; input?: unknown }>,
        currentDraft: OrderDraft | null
    ): Promise<{ toolResults: ToolResultBlock[]; nextDraft: OrderDraft | null }> {
        const toolResults: ToolResultBlock[] = [];
        let nextDraft = currentDraft;

        for (const block of content) {
            if (block.type !== "tool_use" || !block.id || !block.name) continue;
            const executed = await this.executeToolBlock(
                input,
                { id: block.id, name: block.name, input: block.input ?? {} },
                nextDraft
            );
            nextDraft = executed.nextDraft;
            toolResults.push(executed.result);
        }

        return { toolResults, nextDraft };
    }

    private buildHistory(input: AiServiceInput, assistantContent: unknown): AiTurn[] {
        return [
            ...input.history,
            { role: "user" as const, content: input.userText, ts: Date.now() },
            { role: "assistant" as const, content: assistantContent, ts: Date.now() },
        ].slice(-input.limits.maxHistoryTurns);
    }

    private buildSuccess(
        input: AiServiceInput,
        replyText: string,
        marker: IntentMarker,
        toolRoundsUsed: number,
        updatedDraft: OrderDraft | null,
        assistantContent: unknown
    ): AiServiceResult {
        const nextHistory = this.buildHistory(input, assistantContent);
        if (shouldEscalate(input, marker)) {
            return {
                action: "escalate",
                replyText:
                    replyText || "Não estou conseguindo entender bem. Você prefere catálogo, atendente ou tentar de novo?",
                updatedDraft,
                updatedHistory: nextHistory,
                signals: { toolRoundsUsed, intentMarker: marker },
            };
        }

        const shouldConfirm = Boolean(
            updatedDraft?.pendingConfirmation ||
                (updatedDraft != null && isDraftStructurallyCompleteForFinalize(updatedDraft))
        );
        return {
            action: shouldConfirm ? "request_confirmation" : "reply",
            replyText: replyText || "Pode me passar mais detalhes do pedido?",
            updatedDraft,
            updatedHistory: nextHistory,
            signals: { toolRoundsUsed, intentMarker: marker },
        };
    }

    private buildProviderError(input: AiServiceInput, toolRoundsUsed: number): AiServiceResult {
        return {
            action: "error",
            replyText: "Tive uma falha ao processar sua mensagem. Pode tentar novamente?",
            updatedDraft: input.draft,
            updatedHistory: input.history,
            signals: { toolRoundsUsed, intentMarker: "unknown" },
            errorCode: "AI_PROVIDER_ERROR",
        };
    }

    async run(input: AiServiceInput): Promise<AiServiceResult> {
        if (!process.env.ANTHROPIC_API_KEY) {
            return {
                action: "error",
                replyText: "Estou sem conexão com IA agora. Pode tentar novamente em instantes?",
                updatedDraft: input.draft,
                updatedHistory: input.history,
                signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                errorCode: "AI_PROVIDER_ERROR",
            };
        }

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        let messages: AnthropicMessage[] = [
            ...toAnthropicMessages(input.history),
            { role: "user" as const, content: input.userText },
        ];
        let toolRoundsUsed = 0;
        let updatedDraft: OrderDraft | null = input.draft;

        try {
            let response = await this.callModel(client, messages, input.limits.timeoutMs);

            while (response.stop_reason === "tool_use" && toolRoundsUsed < input.limits.maxToolRounds) {
                toolRoundsUsed += 1;
                const round = await this.executeToolRound(
                    input,
                    response.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>,
                    updatedDraft
                );
                updatedDraft = round.nextDraft;

                messages = [
                    ...messages,
                    { role: "assistant", content: response.content },
                    { role: "user", content: round.toolResults },
                ];

                response = await this.callModel(client, messages, input.limits.timeoutMs);
            }

            if (response.stop_reason === "tool_use") {
                return {
                    action: "error",
                    replyText:
                        "Atingimos o limite de consultas automáticas nesta mensagem. Pode repetir o pedido de forma mais curta ou em partes?",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    signals: { toolRoundsUsed, intentMarker: "unknown" },
                    errorCode: "TOOL_FAILED",
                };
            }

            const text = response.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")
                .trim();

            const { visible, marker } = stripIntentMarker(text);
            const visibleSafe = stripHallucinatedOrderPersistenceClaims(
                sanitizeVisibleAgainstDraft(visible, updatedDraft)
            );
            return this.buildSuccess(input, visibleSafe, marker, toolRoundsUsed, updatedDraft, response.content);
        } catch (error) {
            if (isTimeoutError(error)) {
                return {
                    action: "error",
                    replyText: "A IA demorou para responder. Tente novamente em instantes.",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    signals: { toolRoundsUsed, intentMarker: "unknown" },
                    errorCode: "AI_TIMEOUT",
                };
            }
            if (isRateLimitError(error)) {
                return {
                    action: "error",
                    replyText: "Estamos com pico de uso na IA. Aguarde um instante e tente de novo.",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    signals: { toolRoundsUsed, intentMarker: "unknown" },
                    errorCode: "AI_RATE_LIMIT",
                };
            }
            return this.buildProviderError(input, toolRoundsUsed);
        }
    }
}

