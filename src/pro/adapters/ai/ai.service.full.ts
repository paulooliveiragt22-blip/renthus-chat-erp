import Anthropic from "@anthropic-ai/sdk";
import { runWithAnthropicInFlightSlot } from "@/lib/chatbot/anthropicInFlightGate";
import type { MessageCreateParams, ToolChoice } from "@anthropic-ai/sdk/resources/messages";
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
    formatPrepareErrorsForClientReply,
    prepareOrderDraftFromTool,
    shouldPreferPrepareErrorsOverModelText,
    type PrepareOrderDraftCatalogPolicy,
} from "@/lib/chatbot/pro/prepareOrderDraft";
import { toCanonicalDraft } from "@/src/types/contracts.adapters";
import type { PrepareDraftToolInputLegacy } from "@/src/types/contracts.legacy";
import { stripHallucinatedOrderPersistenceClaims } from "./sanitizeAiVisibleOrderClaims";
import { isDraftStructurallyCompleteForFinalize } from "@/src/pro/pipeline/orderDraftGate";
import { stripModelIntentSuffix } from "./stripModelIntentSuffix";

type ToolName = "search_produtos" | "get_order_hints" | "prepare_order_draft";
type IntentMarker = "ok" | "unknown" | null;

/** Igualdade de conjunto de ids de embalagem (ordem do array pode variar). */
function embalagemIdSetsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const bs = new Set(b);
    return a.every((id) => bs.has(id));
}

/**
 * Quando o cliente já tinha várias embalagens na última busca persistida e o modelo
 * terminou em texto sem `prepare_order_draft`, reabrimos uma rodada com tool obrigatória.
 */
export function shouldForcePrepareAfterEmbalagemChoice(params: {
    intent: string;
    step: string;
    allowlistAtStart: string[];
    allowlistNow: string[];
    prepareInvokedThisTurn: boolean;
    draftItemCount: number;
}): boolean {
    if (params.intent !== "order_intent") return false;
    if (params.step !== "pro_collecting_order") return false;
    if (params.allowlistAtStart.length < 2) return false;
    if (!embalagemIdSetsEqual(params.allowlistAtStart, params.allowlistNow)) return false;
    if (params.prepareInvokedThisTurn) return false;
    if (params.draftItemCount > 0) return false;
    return true;
}
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
- Depois que search_produtos listou mais de uma embalagem e o cliente escolheu uma, chame prepare_order_draft na mesma sequência — não siga só com texto sem consolidar o rascunho no servidor.
- Regra dura: em prepare_order_draft use somente produto_embalagem_id que apareceu no JSON items do último search_produtos desta conversa (não invente UUID nem copie de outra busca antiga).
- Após prepare_order_draft: se ok:false, sua mensagem DEVE refletir as errors e o guidance_for_model_pt (sem “erro técnico genérico” quando a causa for validação). Se ok:true, alinhe o texto ao draft.
- Se search_produtos retornar items vazio, não invente produto nem preço; siga guidance_for_model_pt.
- Só peça confirmação explícita de pedido fechado quando o draft do servidor estiver completo e pendente de confirmação.
- Nunca diga que o pedido já foi confirmado, criado no sistema, registrado na loja ou que saiu para entrega: isso só ocorre após confirmação no servidor (fora do modelo).
- Termine a resposta com INTENT_OK ou INTENT_UNKNOWN (sem texto extra após o marcador).`;


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
        `Certo! Segue o rascunho que temos no chat (ainda nao e pedido confirmado na loja):\n${lines.join("\n")}\n` +
        `Total estimado: R$ ${totalFromDraft.toFixed(2).replace(".", ",")}.\n\n`;
    if (draft.paymentMethod) {
        msg += "Revise os dados e confirme o pedido quando estiver tudo certo.";
    } else {
        msg +=
            "Confirme o endereco (use o botao abaixo ou digite o endereco completo). Depois use os botoes de pagamento.";
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

    private async callModel(
        client: Anthropic,
        messages: AnthropicMessage[],
        timeoutMs: number,
        toolChoice?: ToolChoice
    ) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(AI_TIMEOUT_CODE), Math.max(timeoutMs, 1000));
        try {
            const body: MessageCreateParams = {
                model: "claude-haiku-4-5-20251001",
                max_tokens: 900,
                system: SYSTEM_PROMPT,
                messages: messages as MessageCreateParams["messages"],
                tools: [SEARCH_TOOL, HINTS_TOOL, PREPARE_DRAFT_TOOL] as MessageCreateParams["tools"],
            };
            if (toolChoice) body.tool_choice = toolChoice;
            return await runWithAnthropicInFlightSlot(() =>
                client.messages.create(body, {
                    signal: controller.signal,
                } as never)
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

    private async runSearchTool(
        input: AiServiceInput,
        block: { id: string; input: unknown },
        allowlistRuntime: { ids: string[] }
    ): Promise<ToolResultBlock> {
        const payload = (block.input ?? {}) as Record<string, unknown>;
        const query = String(payload.query ?? "");
        const categoryHint = payload.category_hint == null ? null : String(payload.category_hint);
        const rows = await runSearchProdutos(
            this.admin,
            input.context.tenant.companyId,
            query,
            { categoryHint, limit: 8 }
        );
        allowlistRuntime.ids = rows.map((r) => String(r.id));
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
        currentDraft: OrderDraft | null,
        allowlistRuntime: { ids: string[] }
    ): Promise<{
        result: ToolResultBlock;
        nextDraft: OrderDraft | null;
        prepareOutcome: { ok: boolean; errors: string[] };
    }> {
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
        const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
            kind: "search_allowlist",
            allowedEmbalagemIds: allowlistRuntime.ids,
        };
        const prepared = await prepareOrderDraftFromTool(
            this.admin,
            input.context.tenant.companyId,
            effectiveCustomerId,
            legacyInput,
            catalogPolicy
        );
        const addrIn = legacyInput.address;
        const hasStructuredAddress = Boolean(
            addrIn &&
                String(addrIn.logradouro ?? "").trim() &&
                String(addrIn.numero ?? "").trim() &&
                String(addrIn.bairro ?? "").trim()
        );
        const hasAddressPayload =
            Boolean(legacyInput.saved_address_id?.trim()) ||
            Boolean(legacyInput.use_saved_address) ||
            Boolean(legacyInput.address_raw?.trim()) ||
            hasStructuredAddress;
        input.onPrepareDraftToolResult?.({
            companyId: input.context.tenant.companyId,
            threadId: input.context.tenant.threadId,
            ok: prepared.ok,
            errors: prepared.errors,
            hasItems: (legacyInput.items?.length ?? 0) > 0,
            hasAddress: hasAddressPayload,
            payment_method: legacyInput.payment_method ?? null,
            draftItemCount: prepared.draft?.items?.length ?? 0,
        });
        const nextDraft = prepared.draft ? toCanonicalDraft(prepared.draft) : currentDraft;
        return {
            nextDraft,
            prepareOutcome: { ok: prepared.ok, errors: [...prepared.errors] },
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
        currentDraft: OrderDraft | null,
        allowlistRuntime: { ids: string[] }
    ): Promise<{
        result: ToolResultBlock;
        nextDraft: OrderDraft | null;
        prepareOutcome: { ok: boolean; errors: string[] } | null;
    }> {
        const name = block.name as ToolName;
        if (name === "search_produtos") {
            return {
                result: await this.runSearchTool(input, block, allowlistRuntime),
                nextDraft: currentDraft,
                prepareOutcome: null,
            };
        }
        if (name === "get_order_hints") {
            return { result: await this.runHintsTool(input, block), nextDraft: currentDraft, prepareOutcome: null };
        }
        if (name === "prepare_order_draft") {
            const out = await this.runPrepareDraftTool(input, block, currentDraft, allowlistRuntime);
            return { result: out.result, nextDraft: out.nextDraft, prepareOutcome: out.prepareOutcome };
        }
        return {
            result: {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({ ok: false, error: "unsupported_tool", tool: block.name }),
            },
            nextDraft: currentDraft,
            prepareOutcome: null,
        };
    }

    private async executeToolRound(
        input: AiServiceInput,
        content: Array<{ type: string; id?: string; name?: string; input?: unknown }>,
        currentDraft: OrderDraft | null,
        allowlistRuntime: { ids: string[] }
    ): Promise<{
        toolResults: ToolResultBlock[];
        nextDraft: OrderDraft | null;
        prepareOutcomeThisRound: { ok: boolean; errors: string[] } | null;
        invokedPrepare: boolean;
    }> {
        const toolResults: ToolResultBlock[] = [];
        let nextDraft = currentDraft;
        let prepareOutcomeThisRound: { ok: boolean; errors: string[] } | null = null;
        let invokedPrepare = false;

        for (const block of content) {
            if (block.type !== "tool_use" || !block.id || !block.name) continue;
            if (block.name === "prepare_order_draft") invokedPrepare = true;
            const executed = await this.executeToolBlock(
                input,
                { id: block.id, name: block.name, input: block.input ?? {} },
                nextDraft,
                allowlistRuntime
            );
            nextDraft = executed.nextDraft;
            if (executed.prepareOutcome) prepareOutcomeThisRound = executed.prepareOutcome;
            toolResults.push(executed.result);
        }

        return { toolResults, nextDraft, prepareOutcomeThisRound, invokedPrepare };
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
        assistantContent: unknown,
        searchProdutoEmbalagemIds: string[]
    ): AiServiceResult {
        const nextHistory = this.buildHistory(input, assistantContent);
        if (shouldEscalate(input, marker)) {
            return {
                action: "escalate",
                replyText:
                    replyText || "Não estou conseguindo entender bem. Você prefere catálogo, atendente ou tentar de novo?",
                updatedDraft,
                updatedHistory: nextHistory,
                updatedSearchProdutoEmbalagemIds: searchProdutoEmbalagemIds,
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
            updatedSearchProdutoEmbalagemIds: searchProdutoEmbalagemIds,
            signals: { toolRoundsUsed, intentMarker: marker },
        };
    }

    private buildProviderError(
        input: AiServiceInput,
        toolRoundsUsed: number,
        searchProdutoEmbalagemIds: string[]
    ): AiServiceResult {
        return {
            action: "error",
            replyText: "Tive uma falha ao processar sua mensagem. Pode tentar novamente?",
            updatedDraft: input.draft,
            updatedHistory: input.history,
            updatedSearchProdutoEmbalagemIds: searchProdutoEmbalagemIds,
            signals: { toolRoundsUsed, intentMarker: "unknown" },
            errorCode: "AI_PROVIDER_ERROR",
        };
    }

    async run(input: AiServiceInput): Promise<AiServiceResult> {
        const allowlistRuntime = { ids: [...(input.context.session.searchProdutoEmbalagemIds ?? [])] };
        const allowlistAtStart = [...allowlistRuntime.ids];

        if (!process.env.ANTHROPIC_API_KEY) {
            return {
                action: "error",
                replyText: "Estou sem conexão com IA agora. Pode tentar novamente em instantes?",
                updatedDraft: input.draft,
                updatedHistory: input.history,
                updatedSearchProdutoEmbalagemIds: allowlistRuntime.ids,
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
        let lastPrepareOutcome: { ok: boolean; errors: string[] } | null = null;
        let prepareInvokedThisTurn = false;

        try {
            let response = await this.callModel(client, messages, input.limits.timeoutMs);

            while (response.stop_reason === "tool_use" && toolRoundsUsed < input.limits.maxToolRounds) {
                toolRoundsUsed += 1;
                const round = await this.executeToolRound(
                    input,
                    response.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>,
                    updatedDraft,
                    allowlistRuntime
                );
                if (round.invokedPrepare) prepareInvokedThisTurn = true;
                updatedDraft = round.nextDraft;
                if (round.prepareOutcomeThisRound) {
                    lastPrepareOutcome = round.prepareOutcomeThisRound;
                }

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
                    updatedSearchProdutoEmbalagemIds: allowlistRuntime.ids,
                    signals: { toolRoundsUsed, intentMarker: "unknown" },
                    errorCode: "TOOL_FAILED",
                };
            }

            if (
                shouldForcePrepareAfterEmbalagemChoice({
                    intent: input.intentDecision.intent,
                    step: input.context.session.step,
                    allowlistAtStart,
                    allowlistNow: allowlistRuntime.ids,
                    prepareInvokedThisTurn,
                    draftItemCount: updatedDraft?.items?.length ?? 0,
                }) &&
                toolRoundsUsed < input.limits.maxToolRounds
            ) {
                const nudge =
                    "[Instrução interna] O cliente acabou de escolher a embalagem entre opções já listadas (último search_produtos neste chat). Chame prepare_order_draft nesta rodada com items (produto_embalagem_id permitido + quantidade). Se faltar endereço ou pagamento ainda, chame prepare mesmo assim com o que souber — leia guidance_for_model_pt na resposta.";
                const forcePrepareChoice: ToolChoice = {
                    type: "tool",
                    name: "prepare_order_draft",
                    disable_parallel_tool_use: true,
                };
                messages = [
                    ...messages,
                    { role: "assistant", content: response.content },
                    { role: "user", content: nudge },
                ];
                let forceResponse = await this.callModel(
                    client,
                    messages,
                    input.limits.timeoutMs,
                    forcePrepareChoice
                );
                while (forceResponse.stop_reason === "tool_use" && toolRoundsUsed < input.limits.maxToolRounds) {
                    toolRoundsUsed += 1;
                    const round = await this.executeToolRound(
                        input,
                        forceResponse.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>,
                        updatedDraft,
                        allowlistRuntime
                    );
                    if (round.invokedPrepare) prepareInvokedThisTurn = true;
                    updatedDraft = round.nextDraft;
                    if (round.prepareOutcomeThisRound) {
                        lastPrepareOutcome = round.prepareOutcomeThisRound;
                    }
                    messages = [
                        ...messages,
                        { role: "assistant", content: forceResponse.content },
                        { role: "user", content: round.toolResults },
                    ];
                    forceResponse = await this.callModel(client, messages, input.limits.timeoutMs);
                }
                if (forceResponse.stop_reason === "tool_use") {
                    return {
                        action: "error",
                        replyText:
                            "Atingimos o limite de consultas automáticas nesta mensagem. Pode repetir o pedido de forma mais curta ou em partes?",
                        updatedDraft: input.draft,
                        updatedHistory: input.history,
                        updatedSearchProdutoEmbalagemIds: allowlistRuntime.ids,
                        signals: { toolRoundsUsed, intentMarker: "unknown" },
                        errorCode: "TOOL_FAILED",
                    };
                }
                response = forceResponse;
            }

            const text = response.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")
                .trim();

            const { visible, marker } = stripModelIntentSuffix(text);
            let visibleSafe = stripHallucinatedOrderPersistenceClaims(
                sanitizeVisibleAgainstDraft(visible, updatedDraft)
            );
            const hasDraftItems = Boolean(updatedDraft?.items?.length);
            const prepOk = lastPrepareOutcome?.ok ?? null;
            const prepErrs = lastPrepareOutcome?.errors ?? [];
            if (
                shouldPreferPrepareErrorsOverModelText({
                    visible: visibleSafe,
                    hasDraftItems,
                    prepareOk: prepOk,
                    errors: prepErrs,
                })
            ) {
                visibleSafe = formatPrepareErrorsForClientReply(prepErrs);
            }
            return this.buildSuccess(
                input,
                visibleSafe,
                marker,
                toolRoundsUsed,
                updatedDraft,
                response.content,
                allowlistRuntime.ids
            );
        } catch (error) {
            if (isTimeoutError(error)) {
                return {
                    action: "error",
                    replyText: "A IA demorou para responder. Tente novamente em instantes.",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    updatedSearchProdutoEmbalagemIds: allowlistRuntime.ids,
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
                    updatedSearchProdutoEmbalagemIds: allowlistRuntime.ids,
                    signals: { toolRoundsUsed, intentMarker: "unknown" },
                    errorCode: "AI_RATE_LIMIT",
                };
            }
            return this.buildProviderError(input, toolRoundsUsed, allowlistRuntime.ids);
        }
    }
}

