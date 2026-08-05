import { isAnthropicRateLimitError } from "@/lib/chatbot/anthropicResilience";
import type { MessageCreateParams, ToolChoice } from "@anthropic-ai/sdk/resources/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    AiServiceInput,
    AiServiceResult,
    AiTurn,
    OrderDraft,
    PrepareDraftToolInput,
} from "@/src/types/contracts";
import type { AiService } from "../../services/ai/ai.types";
import type { LlmPort } from "@/src/pro/ports/llm.port";
import { createLlmPort } from "@/src/pro/adapters/llm/createLlmPort";
import { hasLlmApiKey } from "@/src/pro/adapters/llm/llmText";
import { runSearchProdutosDetailed } from "@/lib/chatbot/pro/searchProdutos";
import {
    buildDeliverySpecialistSystemPreamble,
    buildPhasePlaybookForModel,
} from "@/lib/chatbot/pro/checkoutPhasePolicy";
import { buildOrderHintsPayload } from "@/lib/chatbot/pro/orderHints";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import {
    buildPrepareDraftGuidanceForModel,
    formatPrepareErrorsForClientReply,
    prepareOrderDraftFromTool,
    shouldPreferPrepareErrorsOverModelText,
    type PrepareOrderDraftCatalogPolicy,
} from "@/lib/chatbot/pro/prepareOrderDraft";
import { normalizePrepareDraftAnthropicInput } from "@/lib/chatbot/pro/normalizePrepareDraftAnthropicInput";
import {
    mergePreparedDraftIntoCurrent,
    unionAllowlistWithDraftIds,
} from "@/src/pro/pipeline/mergeOrderDraft";
import { stripHallucinatedOrderPersistenceClaims } from "./sanitizeAiVisibleOrderClaims";
import { isDraftStructurallyCompleteForFinalize } from "@/src/pro/pipeline/orderDraftGate";
import { isAddressStructurallyComplete } from "@/src/pro/pipeline/orderSlotStep";
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
    if (params.prepareInvokedThisTurn) return false;
    if (!embalagemIdSetsEqual(params.allowlistAtStart, params.allowlistNow)) return false;
    /** Pick de 1 SKU (allowlist estreita): força prepare aditivo mesmo com draft já parcial. */
    const singlePickForce =
        params.allowlistAtStart.length === 1 && params.allowlistNow.length === 1;
    if (params.allowlistAtStart.length < 2 && !singlePickForce) return false;
    if (params.draftItemCount > 0 && !singlePickForce) return false;
    return true;
}
type AnthropicMessage = { role: "user" | "assistant"; content: unknown };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
const AI_TIMEOUT_CODE = "AI_TIMEOUT";

const SEARCH_TOOL = {
    name: "search_produtos",
    description:
        "Busca catálogo real da empresa. Em `query` mantenha o termo do cliente completo (ex.: 'Heineken long neck caixa'), não só a marca. A resposta inclui guidance_for_model_pt.",
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

/** Limite de caracteres do JSON de hints anexado ao system (evita estourar contexto). */
const PREFETCH_ORDER_HINTS_JSON_MAX = 14_000;

const SYSTEM_PROMPT = `${buildDeliverySpecialistSystemPreamble()}
- Fonte de verdade: só cite produto, preço, estoque e totais vindos dos JSONs das tools (search_produtos, get_order_hints, prepare_order_draft). Nunca invente.
- Ordem recomendada: get_order_hints cedo; search_produtos antes de cada produto novo; prepare_order_draft pode ser repetido (cliente pode mandar produto, endereço e pagamento em qualquer ordem).
- Depois que search_produtos listou mais de uma embalagem e o cliente escolheu uma, chame prepare_order_draft na mesma sequência.
- Regra dura: em prepare_order_draft use somente produto_embalagem_id do JSON items do último search_produtos (ou allowed_produto_embalagem_ids).
- Nunca use slug textual: só UUID (campo id / produto_embalagem_id).
- Após prepare_order_draft: se ok:false, reflita errors + guidance_for_model_pt. Se ok:true, siga a fase (endereço UI antes de pedir sim do pedido).
- Se search_produtos retornar items vazio ou did_you_mean, use isso — não invente produto.
- Só peça confirmação final do pedido quando a fase do servidor for confirm_order (endereço UI já confirmado).
- Nunca diga que o pedido já foi criado/entregue: isso só ocorre após confirmação no servidor.
- Termine a resposta com INTENT_OK ou INTENT_UNKNOWN (sem texto extra após o marcador).`;

const SYSTEM_PROMPT_INFO_ONLY = `Você é o assistente PRO da loja (modo só informações).
- Fale PT-BR direto.
- Tire dúvidas sobre produtos, preços e estoque usando search_produtos e get_order_hints.
- NÃO feche pedido, NÃO monte rascunho de pedido e NÃO peça confirmação de compra pelo WhatsApp.
- Se o cliente quiser pedir, oriente a usar o cardápio web / menu da loja ou falar com um atendente.
- Fonte de verdade: só cite produto, preço e estoque vindos dos JSONs das tools. Nunca invente.
- Termine a resposta com INTENT_OK ou INTENT_UNKNOWN (sem texto extra após o marcador).`;

function isInfoOnlyAi(input: AiServiceInput): boolean {
    return input.context.aiOrderMode === "info_only";
}

function toolsForMode(infoOnly: boolean): MessageCreateParams["tools"] {
    if (infoOnly) return [SEARCH_TOOL, HINTS_TOOL] as MessageCreateParams["tools"];
    return [SEARCH_TOOL, HINTS_TOOL, PREPARE_DRAFT_TOOL] as MessageCreateParams["tools"];
}

function buildDraftSnapshotForModel(draft: OrderDraft | null): string {
    if (!draft?.items?.length) return "";
    const lines = draft.items.map(
        (i, idx) =>
            `${idx + 1}. id=${i.produtoEmbalagemId} | ${i.productName} | qty=${i.quantity} | R$ ${i.unitPrice.toFixed(2)}`
    );
    return (
        "\n\n--- Rascunho atual no servidor (não apague itens sem o cliente pedir) ---\n" +
        lines.join("\n") +
        `\npagamento=${draft.paymentMethod ?? "null"} | endereco=${draft.address ? "sim" : "nao"}` +
        "\nEm troca/substituição: search_produtos.query DEVE incluir o nome do produto trocado (ex.: salgadinho), nunca só 'caixa de 15'." +
        "\n--- Fim rascunho ---\n"
    );
}

function buildEffectiveSystemPrompt(input: AiServiceInput): string {
    const base = isInfoOnlyAi(input) ? SYSTEM_PROMPT_INFO_ONLY : SYSTEM_PROMPT;
    const session = input.context.session;
    const draft = input.draft ?? session.draft;
    const phaseBlock = isInfoOnlyAi(input)
        ? ""
        : "\n\n" +
          buildPhasePlaybookForModel({
              step: session.step,
              deliveryAddressUiConfirmed: session.deliveryAddressUiConfirmed,
              hasDraftItems: Boolean(draft?.items?.length),
              hasPayment: Boolean(draft?.paymentMethod),
              addressComplete: isAddressStructurallyComplete(draft?.address ?? null),
          });
    const editHoldBlock =
        session.checkoutEditHold && !isInfoOnlyAi(input)
            ? "\n\nModo edição (Corrigir/Adicionar): NÃO reconstrua o carrinho do zero. Mantenha itens existentes; prepare_order_draft é aditivo.\n"
            : "";
    const draftBlock = isInfoOnlyAi(input) ? "" : buildDraftSnapshotForModel(draft);

    const prefix = base + phaseBlock + editHoldBlock + draftBlock;
    const hints = input.context.prefetchedOrderHints;
    if (!hints || typeof hints !== "object") return prefix;
    try {
        let body = JSON.stringify(hints);
        if (body.length > PREFETCH_ORDER_HINTS_JSON_MAX) {
            body = body.slice(0, PREFETCH_ORDER_HINTS_JSON_MAX) + "…[truncado]";
        }
        return (
            prefix +
            "\n\n--- Dados do cadastro (servidor; válidos nesta mensagem) ---\n" +
            body +
            "\n--- Fim dados cadastro ---\n" +
            "Use saved_addresses / saved_address para endereços já cadastrados; favorite_lines são produtos favoritos. " +
            "Pode chamar get_order_hints para atualizar, mas trate estes dados como já carregados nesta volta."
        );
    } catch {
        return prefix;
    }
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
        `Certo! Segue o rascunho que temos no chat (ainda nao e pedido confirmado na loja):\n${lines.join("\n")}\n` +
        `Total estimado: R$ ${totalFromDraft.toFixed(2).replace(".", ",")}.\n\n`;
    if (draft.paymentMethod) {
        msg += "Confirme o endereco nos botoes abaixo; a confirmacao final do pedido vem depois.";
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
    if (error instanceof Error && (error.name === "AbortError" || error.name === "LlmTimeoutError")) {
        return true;
    }
    if (!error || typeof error !== "object") return false;
    const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
    const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    return message.includes(AI_TIMEOUT_CODE) || code === AI_TIMEOUT_CODE;
}

function isRateLimitError(error: unknown): boolean {
    return isAnthropicRateLimitError(error);
}

export class FullAiServiceAdapter implements AiService {
    private readonly llm: LlmPort;

    constructor(
        private readonly admin: SupabaseClient,
        llm?: LlmPort
    ) {
        this.llm = llm ?? createLlmPort(admin);
    }

    private async callModel(
        messages: AnthropicMessage[],
        timeoutMs: number,
        toolChoice: ToolChoice | undefined,
        systemPrompt: string,
        companyId: string | undefined,
        tools: MessageCreateParams["tools"]
    ) {
        const response = await this.llm.chat({
            system: systemPrompt,
            messages,
            tools: tools as unknown as Record<string, unknown>[],
            toolChoice: toolChoice as never,
            maxTokens: 900,
            timeoutMs,
            companyId,
            purpose: "pro_ai_service_full",
        });
        return {
            content: response.content,
            stop_reason: response.stopReason,
            usage: {
                input_tokens: response.usage?.inputTokens,
                output_tokens: response.usage?.outputTokens,
            },
        };
    }

    private toPrepareToolInput(raw: Record<string, unknown>): PrepareDraftToolInput {
        return normalizePrepareDraftAnthropicInput(raw);
    }

    private async runSearchTool(
        input: AiServiceInput,
        block: { id: string; input: unknown },
        allowlistRuntime: { ids: string[] },
        searchMeta: {
            lastSearchPicks: Array<{ embalagemId: string; label: string }>;
            emptySearchStreak: number;
        }
    ): Promise<ToolResultBlock> {
        const payload = (block.input ?? {}) as Record<string, unknown>;
        const query = String(payload.query ?? "");
        const categoryHint = payload.category_hint == null ? null : String(payload.category_hint);
        const detailed = await runSearchProdutosDetailed(
            this.admin,
            input.context.tenant.companyId,
            query,
            { categoryHint, limit: 8 }
        );
        const rows = detailed.items;
        allowlistRuntime.ids = rows.map((r) => String(r.id));
        searchMeta.lastSearchPicks = rows.slice(0, 3).map((r) => ({
            embalagemId: String(r.id),
            label: String(r.display_name || r.product_name || "Item").slice(0, 40),
            price: Number((r as { preco_venda?: unknown }).preco_venda ?? NaN),
        })).map((p) => ({
            ...p,
            price: Number.isFinite(p.price) ? p.price : null,
        }));
        searchMeta.emptySearchStreak = detailed.empty
            ? (input.context.session.emptySearchStreak ?? 0) + 1
            : 0;
        const guidanceForModelPt =
            rows.length > 0
                ? [
                      "Use apenas o UUID de cada linha em items (campos id ou produto_embalagem_id) em prepare_order_draft — não invente UUID.",
                      `IDs exatos desta busca (copie um literalmente): ${allowlistRuntime.ids.join(", ")}.`,
                      ...(detailed.didYouMean.length
                          ? [
                                `did_you_mean: ${detailed.didYouMean.map((d) => d.label).join(" | ")}. Ofereça essas opções se o cliente digitou errado.`,
                            ]
                          : []),
                      ...(rows.length >= 2
                          ? [
                                "Há mais de uma opção: NÃO liste preços/opções no texto — o servidor envia botões/lista. Só confirme que há opções e peça para tocar no botão ou responder com o número.",
                            ]
                          : []),
                  ]
                : [
                      "Nenhum item no catálogo para este termo (busca fuzzy também vazia).",
                      "Não invente nome nem preço. Peça outro termo mais curto ou categoria; opcionalmente oriente o cardápio web.",
                  ];
        return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({
                items: rows,
                did_you_mean: detailed.didYouMean,
                query_normalized: detailed.queryNormalized,
                produto_embalagem_ids_validos: allowlistRuntime.ids,
                guidance_for_model_pt: guidanceForModelPt,
            }),
        };
    }

    private async runHintsTool(input: AiServiceInput, block: { id: string }): Promise<ToolResultBlock> {
        const cached = input.context.prefetchedOrderHints;
        if (cached && typeof cached === "object") {
            return {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({
                    ...cached,
                    guidance_for_model_pt: [
                        "Hints já carregados no servidor neste turno — use saved_addresses/favoritos sem nova busca.",
                    ],
                }),
            };
        }
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
        const toolInput = this.toPrepareToolInput(raw);
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
        const allowedEmbalagemIds = unionAllowlistWithDraftIds(allowlistRuntime.ids, currentDraft);
        const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
            kind: "search_allowlist",
            allowedEmbalagemIds,
        };
        const prepared = await prepareOrderDraftFromTool(
            this.admin,
            input.context.tenant.companyId,
            effectiveCustomerId,
            toolInput,
            catalogPolicy
        );
        const addrIn = toolInput.address;
        const hasStructuredAddress = Boolean(
            addrIn &&
                String(addrIn.logradouro ?? "").trim() &&
                String(addrIn.numero ?? "").trim() &&
                String(addrIn.bairro ?? "").trim()
        );
        const hasAddressPayload =
            Boolean(toolInput.savedAddressId?.trim()) ||
            Boolean(toolInput.useSavedAddress) ||
            Boolean(toolInput.addressRaw?.trim()) ||
            hasStructuredAddress;
        const nextDraft = mergePreparedDraftIntoCurrent(currentDraft, prepared.draft);
        input.onPrepareDraftToolResult?.({
            companyId: input.context.tenant.companyId,
            threadId: input.context.tenant.threadId,
            ok: prepared.ok,
            errors: prepared.errors,
            hasItems: (toolInput.items?.length ?? 0) > 0,
            hasAddress: hasAddressPayload,
            payment_method: toolInput.paymentMethod ?? null,
            draftItemCount: nextDraft?.items?.length ?? 0,
        });
        const allowedIds = allowedEmbalagemIds.length ? [...allowedEmbalagemIds] : [];
        const baseGuidance = buildPrepareDraftGuidanceForModel(prepared.ok, prepared.errors, {
            deliveryAddressUiConfirmed: input.context.session.deliveryAddressUiConfirmed,
            nextRequiredSlot: prepared.next_required_slot ?? null,
            hasPartialDraft: Boolean(nextDraft?.items?.length) && !prepared.ok,
        });
        const idHint =
            !prepared.ok && allowedIds.length
                ? [
                      `allowed_produto_embalagem_ids: copie um destes valores para items[].produto_embalagem_id ou items[].id no próximo prepare_order_draft: ${allowedIds.join(", ")}.`,
                  ]
                : [];
        return {
            nextDraft,
            prepareOutcome: { ok: prepared.ok, errors: [...prepared.errors] },
            result: {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({
                    ok: prepared.ok,
                    errors: prepared.errors,
                    has_draft: Boolean(nextDraft),
                    draft_item_count: nextDraft?.items?.length ?? 0,
                    next_required_slot: prepared.next_required_slot ?? null,
                    ...(!prepared.ok && allowedIds.length ? { allowed_produto_embalagem_ids: allowedIds } : {}),
                    guidance_for_model_pt: [...baseGuidance, ...idHint],
                }),
            },
        };
    }

    private async executeToolBlock(
        input: AiServiceInput,
        block: { id: string; name: string; input: unknown },
        currentDraft: OrderDraft | null,
        allowlistRuntime: { ids: string[] },
        searchMeta: {
            lastSearchPicks: Array<{ embalagemId: string; label: string }>;
            emptySearchStreak: number;
        }
    ): Promise<{
        result: ToolResultBlock;
        nextDraft: OrderDraft | null;
        prepareOutcome: { ok: boolean; errors: string[] } | null;
    }> {
        const name = block.name as ToolName;
        if (name === "search_produtos") {
            return {
                result: await this.runSearchTool(input, block, allowlistRuntime, searchMeta),
                nextDraft: currentDraft,
                prepareOutcome: null,
            };
        }
        if (name === "get_order_hints") {
            return { result: await this.runHintsTool(input, block), nextDraft: currentDraft, prepareOutcome: null };
        }
        if (name === "prepare_order_draft") {
            if (isInfoOnlyAi(input)) {
                return {
                    result: {
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: JSON.stringify({
                            ok: false,
                            error: "info_only_mode",
                            guidance_for_model_pt:
                                "Modo só informações: não feche pedido. Oriente cardápio web ou atendente.",
                        }),
                    },
                    nextDraft: currentDraft,
                    prepareOutcome: { ok: false, errors: ["info_only_mode"] },
                };
            }
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
        allowlistRuntime: { ids: string[] },
        searchMeta: {
            lastSearchPicks: Array<{ embalagemId: string; label: string }>;
            emptySearchStreak: number;
        }
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
                allowlistRuntime,
                searchMeta
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
        searchProdutoEmbalagemIds: string[],
        searchMeta: {
            lastSearchPicks: Array<{ embalagemId: string; label: string }>;
            emptySearchStreak: number;
        }
    ): AiServiceResult {
        const nextHistory = this.buildHistory(input, assistantContent);
        const addrUiOk = input.context.session.deliveryAddressUiConfirmed === true;
        if (shouldEscalate(input, marker)) {
            return {
                action: "escalate",
                replyText:
                    replyText || "Não estou conseguindo entender bem. Você prefere catálogo, atendente ou tentar de novo?",
                updatedDraft,
                updatedHistory: nextHistory,
                updatedSearchProdutoEmbalagemIds: searchProdutoEmbalagemIds,
                lastSearchPicks: searchMeta.lastSearchPicks,
                emptySearchStreak: searchMeta.emptySearchStreak,
                signals: { toolRoundsUsed, intentMarker: marker },
            };
        }

        // Só request_confirmation quando endereço UI já confirmado (evita misturar com CTA de endereço)
        const shouldConfirm = Boolean(
            addrUiOk &&
                (updatedDraft?.pendingConfirmation ||
                    (updatedDraft != null && isDraftStructurallyCompleteForFinalize(updatedDraft)))
        );
        return {
            action: shouldConfirm ? "request_confirmation" : "reply",
            replyText: replyText || "Pode me passar mais detalhes do pedido?",
            updatedDraft,
            updatedHistory: nextHistory,
            updatedSearchProdutoEmbalagemIds: searchProdutoEmbalagemIds,
            lastSearchPicks: searchMeta.lastSearchPicks,
            emptySearchStreak: searchMeta.emptySearchStreak,
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
        const searchMeta = {
            lastSearchPicks: [...(input.context.session.lastSearchPicks ?? [])],
            emptySearchStreak: input.context.session.emptySearchStreak ?? 0,
        };

        if (!hasLlmApiKey()) {
            return {
                action: "error",
                replyText: "Estou sem conexão com IA agora. Pode tentar novamente em instantes?",
                updatedDraft: input.draft,
                updatedHistory: input.history,
                updatedSearchProdutoEmbalagemIds: allowlistRuntime.ids,
                lastSearchPicks: searchMeta.lastSearchPicks,
                emptySearchStreak: searchMeta.emptySearchStreak,
                signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                errorCode: "AI_PROVIDER_ERROR",
            };
        }

        let messages: AnthropicMessage[] = [
            ...toAnthropicMessages(input.history),
            { role: "user" as const, content: input.userText },
        ];
        let toolRoundsUsed = 0;
        let updatedDraft: OrderDraft | null = input.draft;
        let lastPrepareOutcome: { ok: boolean; errors: string[] } | null = null;
        let prepareInvokedThisTurn = false;

        try {
            const infoOnly = isInfoOnlyAi(input);
            const tools = toolsForMode(infoOnly);
            const systemPrompt = buildEffectiveSystemPrompt(input);
            const companyId = input.context.tenant.companyId;
            const firstToolChoice: ToolChoice | undefined =
                !infoOnly && input.preferPrepareToolChoiceFirst
                    ? {
                          type: "tool",
                          name: "prepare_order_draft",
                          disable_parallel_tool_use: true,
                      }
                    : undefined;
            let response = await this.callModel(
                messages,
                input.limits.timeoutMs,
                firstToolChoice,
                systemPrompt,
                companyId,
                tools
            );

            while (response.stop_reason === "tool_use" && toolRoundsUsed < input.limits.maxToolRounds) {
                toolRoundsUsed += 1;
                const round = await this.executeToolRound(
                    input,
                    response.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>,
                    updatedDraft,
                    allowlistRuntime,
                    searchMeta
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

                response = await this.callModel(
                    messages,
                    input.limits.timeoutMs,
                    undefined,
                    systemPrompt,
                    companyId,
                    tools
                );
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
                !infoOnly &&
                !input.skipForcePrepareAfterPick &&
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
                    messages,
                    input.limits.timeoutMs,
                    forcePrepareChoice,
                    systemPrompt,
                    companyId,
                    tools
                );
                while (forceResponse.stop_reason === "tool_use" && toolRoundsUsed < input.limits.maxToolRounds) {
                    toolRoundsUsed += 1;
                    const round = await this.executeToolRound(
                        input,
                        forceResponse.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>,
                        updatedDraft,
                        allowlistRuntime,
                        searchMeta
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
                    forceResponse = await this.callModel(
                        messages,
                        input.limits.timeoutMs,
                        undefined,
                        systemPrompt,
                        companyId,
                        tools
                    );
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
                .filter((b): b is { type: "text"; text: string } =>
                    Boolean(b && typeof b === "object" && (b as { type?: string }).type === "text")
                )
                .map((b) => String(b.text ?? ""))
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
                allowlistRuntime.ids,
                searchMeta
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

