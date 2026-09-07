/**
 * Loop de IA do agente PRO — Vercel AI SDK (Fase 3 da migração, ver
 * docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md). Substitui `ai.service.full.ts` (deletado no
 * mesmo commit): `generateText` com tools + `stopWhen`/`prepareStep` no lugar do loop
 * manual de `tool_use`, e a tool final `respond_to_customer` no lugar dos marcadores de
 * texto `INTENT_OK`/`INTENT_UNKNOWN`/`ADDR_FREE_TEXT`.
 */

import { generateText, stepCountIs, tool, InvalidToolInputError, NoSuchToolError, type LanguageModel } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    AiServiceInput,
    AiServiceResult,
    AiTurn,
    OrderDraft,
    OrderWorklist,
    PendingPickGroup,
} from "@/src/types/contracts";
import type { AiService } from "../../services/ai/ai.types";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import type { OrderDraftPort } from "@/src/pro/ports/orderDraft.port";
import type { SessionMemoryPort } from "@/src/pro/ports/sessionMemory.port";
import type { MetricsPort } from "@/src/pro/ports/metrics.port";
import type { OrderLinesExtractPort } from "@/src/pro/ports/orderLinesExtract.port";
import { SupabaseCatalogAdapter } from "@/src/pro/adapters/supabase/catalog.supabase";
import { SupabaseOrderDraftAdapter } from "@/src/pro/adapters/supabase/orderDraft.supabase";
import { NoopSessionMemoryAdapter } from "@/src/pro/adapters/ai/sessionMemory.llm";
import { LlmOrderLinesExtractAdapter, FakeOrderLinesExtractAdapter } from "@/src/pro/adapters/ai/orderLinesExtract.llm";
import {
    listLinesByStatus,
    pendingSearchTermsFromWorklist,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import { seedWorklistFromExtract } from "@/src/pro/pipeline/orderWorklist/seedWorklistFromExtract";
import { extractCandidatePendingTermsFromUserText } from "@/src/pro/domain/orderWorklist/extractCandidateTerms";
import {
    advanceWorklistAfterSearch,
    shouldForceSearchWorklist,
} from "@/src/pro/pipeline/orderWorklist/advanceWorklistAfterSearch";
import { matchWorklistLineForSearch } from "@/src/pro/domain/orderWorklist/matchWorklistLine";
import { hasLlmApiKey } from "@/src/pro/adapters/llm/llmText";
import {
    LlmProviderConfigError,
    getConfiguredLlmProviderName,
    resolveLanguageModel,
    type LlmProviderName,
} from "@/src/pro/adapters/ai/modelProvider";
import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import type { GroqLanguageModelOptions } from "@ai-sdk/groq";
import {
    extractExplicitOrderQuantityFromText,
    hasExplicitOrderQuantityInText,
} from "@/src/pro/tools/parseQtyPt";
import { mergePreparedDraftIntoCurrent, unionAllowlistIds, unionAllowlistWithDraftIds } from "@/src/pro/pipeline/mergeOrderDraft";
import {
    formatPrepareErrorsForClientReply,
    shouldPreferPrepareErrorsOverModelText,
} from "@/src/pro/tools/prepareOrderDraft";
import {
    stripHallucinatedOrderPersistenceClaims,
    stripInternalCatalogIdsFromCustomerText,
} from "./sanitizeAiVisibleOrderClaims";
import { isDraftStructurallyCompleteForFinalize } from "@/src/pro/pipeline/orderDraftGate";
import { createSearchProdutosTool } from "@/src/pro/adapters/ai/tools/searchProdutos.tool";
import { createGetOrderHintsTool } from "@/src/pro/adapters/ai/tools/getOrderHints.tool";
import { createPrepareOrderDraftTool } from "@/src/pro/adapters/ai/tools/prepareOrderDraft.tool";
import { createResolvePendingPicksTool } from "@/src/pro/adapters/ai/tools/resolvePendingPicks.tool";
import { createInitialTurnState, type SearchPickSummary, type TurnState } from "@/src/pro/adapters/ai/tools/turnState";
import { runSearchProdutosForAi } from "@/src/pro/adapters/ai/tools/searchProdutosForAi";
import {
    isLlmRateLimitError,
    runLlmWithResilience,
    type CircuitStateChangeEvent,
} from "@/lib/chatbot/llmResilience";
import { debitFromAnthropicUsage } from "@/lib/billing/aiWallet";
import { wrapUserInboundForLlm } from "./userInboundGuard";
import { budgetAiHistoryForLlm } from "./aiHistoryBudget";
import {
    anthropicCacheProviderOptions,
    isLlmPromptCacheEnabled,
} from "./promptCache";
import { buildPromptPartsForCache } from "./promptParts";

export { buildPromptPartsForCache } from "./promptParts";
import {
    buildPickClarificationFreeText,
    upsertPendingPickGroup,
} from "@/src/pro/pipeline/pendingPickGroups";

export type AiServiceOptions = {
    catalog?: CatalogPort;
    orderDraft?: OrderDraftPort;
    sessionMemory?: SessionMemoryPort;
    /** Extract estruturado 1× por selo de mensagem (ADR 0011). */
    orderLinesExtract?: OrderLinesExtractPort;
    /**
     * Seam de teste/replay — injeta `MockLanguageModelV3`/`createReplayModel`
     * (`src/pro/adapters/ai/replayRecorder.ts`) em vez de `resolveLanguageModel()`/rede.
     */
    model?: LanguageModel;
    /**
     * Provider/modelo resolvidos por empresa (`company_settings.llm_provider`, ver
     * docs/PLANO_MULTI_PROVIDER_IA.md). Distintos de `model` acima — aquele é só o seam de
     * teste/replay. Ausentes = comportamento atual (env global via `getConfiguredLlmProviderName()`).
     */
    providerOverride?: LlmProviderName;
    modelNameOverride?: string;
    /**
     * Observabilidade do circuit breaker (Fase 9) — ver `deps.factory.ts` pra quem conecta ao `MetricsPort`.
     */
    onCircuitStateChange?: (e: CircuitStateChangeEvent) => void;
    /** Emite `pro_pipeline.ai_tokens_*` por step (opcional). */
    metrics?: MetricsPort;
};

type IntentMarker = "ok" | "unknown";

/** Igualdade de conjunto de ids de embalagem (ordem do array pode variar). */
function embalagemIdSetsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const bs = new Set(b);
    return a.every((id) => bs.has(id));
}

/**
 * Quando o cliente já tinha várias embalagens na última busca persistida e o modelo
 * terminou sem `prepare_order_draft`, forçamos a tool no próximo step (`prepareStep`).
 *
 * Allowlist com **1** SKU só da sessão (sem search neste turno) NÃO força prepare —
 * isso travava `tool_choice=prepare_order_draft` e a Groq tentava `search_produtos`
 * → TOOL_FAILED. O caso 1 SKU pós-search deste turno fica em
 * `shouldForcePrepareAfterUnambiguousSearch`.
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
    /** Multi-embalagem (≥2) da oferta anterior — cliente escolheu em prosa neste turno. */
    if (params.allowlistAtStart.length < 2) return false;
    if (params.draftItemCount > 0) return false;
    return true;
}

/**
 * Search neste turno com SKU(s) ainda fora do draft → força `prepare_order_draft`
 * **só** se o cliente já disse a quantidade (C3.2) e não há clarificação de embalagem.
 * Multi-produto unívoco (ex.: Original + Heineken, 2 IDs na allowlist): força prepare
 * dos N SKUs novos (até 5). Ambíguo (lastSearchPicks≥2 / pendingPickGroups) → não força.
 */
export function shouldForcePrepareAfterUnambiguousSearch(params: {
    intent: string;
    step: string;
    prepareInvokedThisTurn: boolean;
    searchInvokedThisTurn: boolean;
    allowlistNowCount: number;
    /** Embalagens na allowlist que ainda não estão no draft. */
    pendingAllowlistNotInDraftCount: number;
    /** Texto do cliente neste turno — precisa de qty explícita. */
    userText: string;
    /** Clarificação UN/CX ainda aberta — não montar rascunho. */
    pendingPickGroupsCount?: number;
    lastSearchPicksCount?: number;
    pendingSearchTermsCount?: number;
}): boolean {
    if (params.intent !== "order_intent") return false;
    if (params.step !== "pro_collecting_order" && params.step !== "pro_idle") return false;
    if (!params.searchInvokedThisTurn) return false;
    if (!hasExplicitOrderQuantityInText(params.userText)) return false;
    if ((params.pendingPickGroupsCount ?? 0) > 0) return false;
    if ((params.lastSearchPicksCount ?? 0) >= 2) return false;
    if ((params.pendingSearchTermsCount ?? 0) > 0) return false;
    const pending = params.pendingAllowlistNotInDraftCount;
    if (pending < 1 || pending > 5) return false;
    return true;
}

/** Quantos IDs da allowlist ainda não estão no rascunho. */
export function countAllowlistIdsNotInDraft(
    allowlistIds: readonly string[],
    draft: OrderDraft | null
): number {
    const inDraft = new Set(
        (draft?.items ?? [])
            .map((i) => String(i.produtoEmbalagemId ?? "").trim())
            .filter(Boolean)
    );
    let n = 0;
    const seen = new Set<string>();
    for (const id of allowlistIds) {
        const s = String(id ?? "").trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        if (!inDraft.has(s)) n += 1;
    }
    return n;
}

/**
 * Enquanto há lines `pending_search` na worklist, o turno não pode fechar via
 * `respond_to_customer` sem forçar `search_produtos`. Lifecycle só no servidor (ADR 0011).
 */
export function shouldForceSearchForDeclaredPendingTerms(params: {
    infoOnly: boolean;
    pendingTerms: readonly string[];
    /** Turno só a resolver pick já listado — não force-search (ADR 0011 D5). */
    pickResolveTurn?: boolean;
}): boolean {
    if (params.infoOnly || params.pickResolveTurn) return false;
    return params.pendingTerms.length > 0;
}

const FORCE_PREPARE_NUDGE =
    "[Instrução interna] Contrato exige prepare_order_draft agora: há SKU permitido (allowlist) e intenção de pedido. Chame prepare_order_draft com items (produto_embalagem_id permitido + quantidade). Se faltar endereço ou pagamento, prepare mesmo assim com o que souber — leia guidance_for_model_pt.";

/**
 * Há produto(s) do cliente ainda não buscado(s) na worklist (`pending_search`).
 * Força search_produtos agora: sem isso o item pode sumir silenciosamente do pedido
 * (bug real: "quero skol e original" resolvia só "original").
 */
function buildForceSearchPendingNudge(pendingTerms: readonly string[]): string {
    const list = pendingTerms.map((m) => `"${m}"`).join(", ");
    return `[Instrução interna] Contrato exige search_produtos agora para item(ns) que o cliente pediu e ainda não foi(ram) buscado(s) neste atendimento: ${list}. Chame search_produtos para o próximo destes antes de responder (a worklist do servidor já guarda o restante).`;
}

/**
 * Há grupo(s) de embalagem (UN/CX/Fardo) pendente(s) — o resolvedor determinístico
 * (`resolvePendingPickGroupsFromFreeText`, rodado antes da IA em `runProPipeline`) não
 * conseguiu casar 100% da resposta do cliente. Uma tentativa via IA (`resolve_pending_picks`,
 * schema-enforced) antes de deixar fechar o turno — não é loop forçado (ver
 * `forceResolvePendingPicksNudgeInjected`): se o modelo não resolver nesta tentativa, o grupo
 * continua pendente e a rede de segurança por turnos (`groupsPastSafetyNet`) assume depois.
 *
 * Exportada p/ testes C3.2 — o caller deve passar só grupos de **carryover** (não os criados
 * por search neste mesmo turno).
 */
export function shouldForceResolvePendingPicks(params: {
    infoOnly: boolean;
    pendingPickGroups: readonly PendingPickGroup[];
}): boolean {
    if (params.infoOnly) return false;
    return params.pendingPickGroups.length > 0;
}

function buildForceResolvePendingPicksNudge(groups: readonly PendingPickGroup[]): string {
    const list = groups
        .map((g) => `${g.productLabel} (product_key="${g.productKey}", opções: ${g.options.map((o) => o.embalagemId).join(" | ")})`)
        .join("; ");
    return `[Instrução interna] O cliente respondeu sobre a embalagem de produto(s) com múltiplas opções ainda pendentes: ${list}. Se a mensagem do cliente já esclarece algum destes, chame resolve_pending_picks agora com o produto_embalagem_id exato. Se não esclarece nenhum, pode responder normalmente pedindo para o cliente especificar.`;
}

/** Limite legado — hints agora em `promptParts.ts`. */
function isInfoOnlyAi(input: AiServiceInput): boolean {
    return input.context.aiOrderMode === "info_only";
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
        `Certo! Segue o rascunho que temos no chat (ainda não é pedido confirmado na loja):\n${lines.join("\n")}\n` +
        `Total estimado: R$ ${totalFromDraft.toFixed(2).replace(".", ",")}.\n\n`;
    if (draft.paymentMethod) {
        msg += "Confirme o endereço nos botões abaixo; a confirmação final do pedido vem depois.";
    } else {
        msg +=
            "Confirme o endereço (use o botão abaixo ou digite o endereço completo). Depois use os botões de pagamento.";
    }
    return msg.trim();
}

function historyToModelMessages(
    history: AiTurn[],
    maxHistoryTurns: number
): Array<{ role: "user" | "assistant"; content: string }> {
    return budgetAiHistoryForLlm(history, { maxTurns: maxHistoryTurns }).map((h) => ({
        role: h.role,
        content: typeof h.content === "string" ? h.content : JSON.stringify(h.content ?? ""),
    }));
}

function buildNextHistory(input: AiServiceInput, assistantReplyText: string): AiTurn[] {
    const capped = budgetAiHistoryForLlm(input.history, { maxTurns: input.limits.maxHistoryTurns });
    return [
        ...capped,
        { role: "user" as const, content: wrapUserInboundForLlm(input.userText), ts: Date.now() },
        { role: "assistant" as const, content: assistantReplyText, ts: Date.now() },
    ].slice(-input.limits.maxHistoryTurns);
}

function shouldEscalate(input: AiServiceInput, marker: IntentMarker): boolean {
    const streak = input.context.session.misunderstandingStreak;
    if (marker === "ok") return false;
    if (input.intentDecision.intent === "human_intent") return true;
    return streak + 1 >= input.context.policies.escalationRule.unknownConsecutive;
}

function isTimeoutError(error: unknown): boolean {
    const name = (e: unknown): string => (e instanceof Error ? e.name : "");
    if (name(error) === "AbortError" || name(error) === "TimeoutError") return true;
    const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : null;
    return name(cause) === "AbortError" || name(cause) === "TimeoutError";
}

function isRateLimitError(error: unknown): boolean {
    if (isLlmRateLimitError(error)) return true;
    if (error && typeof error === "object") {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        if (statusCode === 429) return true;
    }
    return false;
}

const RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION =
    "Tool final OBRIGATÓRIA: use para enviar a resposta ao cliente. Chame sempre por último, " +
    "inclusive em saudação, erro ou dúvida — nunca responda em texto puro sem esta tool. " +
    "NÃO diga que o pedido foi criado/confirmado/entregue (só o botão Confirmar + RPC no servidor). " +
    "NÃO peça para digitar sim/confirmar — o servidor envia botões.";

function createRespondToCustomerTool(opts?: {
    anthropicCache?: boolean;
}) {
    return tool({
        description: RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION,
        inputSchema: z.object({
            reply_text: z.string().describe("Mensagem final ao cliente, em PT-BR."),
            address_free_text: z
                .boolean()
                .nullish()
                .describe(
                    "true só quando esta resposta é o texto livre de confirmação de endereço (cliente questionou endereço diferente do cadastrado); null caso contrário."
                ),
            understood: z
                .boolean()
                .nullish()
                .describe("false só quando não entendeu a mensagem do cliente; null = entendeu."),
        }),
        ...(opts?.anthropicCache
            ? { providerOptions: anthropicCacheProviderOptions() }
            : {}),
        execute: async (args) => args,
    });
}

/** Descrição canónica da tool final — testes C3.4. */
export function respondToCustomerToolDescription(): string {
    return RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION;
}

type StepLike = { toolCalls?: ReadonlyArray<{ toolName: string }> };

function lastStepCalledRespond(steps: readonly StepLike[]): boolean {
    return Boolean(steps.at(-1)?.toolCalls?.some((c) => c.toolName === "respond_to_customer"));
}

function stepsHadBusinessTool(steps: readonly StepLike[]): boolean {
    return steps.some((s) =>
        s.toolCalls?.some(
            (c) =>
                c.toolName === "search_produtos" ||
                c.toolName === "prepare_order_draft" ||
                c.toolName === "resolve_pending_picks"
        )
    );
}

function isModelSkippedRequiredToolError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes("did not call a tool");
}

/** Groq/OpenAI: `AI_APICallError` com schema de tool (não vira InvalidToolInputError do SDK). */
function isToolCallSchemaValidationError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return (
        /tool call validation failed/i.test(msg) ||
        /did not match schema/i.test(msg) ||
        /missing properties:/i.test(msg)
    );
}

/** Force `tool_choice=prepare` e o modelo pediu `search_produtos` (ou outra tool). */
function isToolChoiceMismatchError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /does not match request\.tool_choice/i.test(msg);
}

function formatBrl(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

/** Resposta determinística quando o modelo buscou o catálogo mas não chamou respond_to_customer (Groq). */
export function buildSearchPicksFallbackReply(
    picks: SearchPickSummary[],
    pendingGroups: readonly PendingPickGroup[] = [],
    userText?: string
): string {
    if (pendingGroups.length > 0) {
        return buildPickClarificationFreeText(pendingGroups);
    }
    if (picks.length === 0) {
        return "Não encontrei esse item no cardápio agora. Quer ver o cardápio completo ou tentar outro nome?";
    }
    if (picks.length === 1) {
        const p = picks[0]!;
        const price =
            p.price != null && Number.isFinite(p.price) ? ` por R$ ${formatBrl(p.price)}` : "";
        const qty = extractExplicitOrderQuantityFromText(userText ?? "");
        if (qty != null) {
            return `Anotei ${qty}× ${p.label}${price}.`;
        }
        return `Sim! Temos ${p.label}${price}. Quantas unidades você quer?`;
    }
    const lines = picks.map((p) => {
        const price =
            p.price != null && Number.isFinite(p.price) ? ` — R$ ${formatBrl(p.price)}` : "";
        return `• ${p.label}${price}`;
    });
    return `Encontrei estas opções:\n${lines.join("\n")}\nQual você prefere?`;
}

/**
 * Groq às vezes busca o SKU e cai no fallback sem `prepare_order_draft`.
 * Se o cliente já disse a quantidade, o servidor monta o rascunho (não pergunta de novo).
 */
export async function applySearchFallbackPrepareIfQtyKnown(params: {
    orderDraft: OrderDraftPort;
    companyId: string;
    customerId: string | null;
    userText: string;
    turnState: TurnState;
}): Promise<boolean> {
    const { turnState } = params;
    if (turnState.pendingPickGroups.length > 0) return false;
    if (turnState.lastSearchPicks.length !== 1) return false;
    if (turnState.prepareInvokedThisTurn) return false;
    const qty = extractExplicitOrderQuantityFromText(params.userText);
    const embId = turnState.lastSearchPicks[0]?.embalagemId?.trim();
    if (qty == null || !embId) return false;

    const allowedEmbalagemIds = unionAllowlistWithDraftIds(turnState.allowlistIds, turnState.currentDraft);
    const prepared = await params.orderDraft.prepareFromToolInput({
        companyId: params.companyId,
        customerId: params.customerId,
        body: { items: [{ produtoEmbalagemId: embId, quantity: qty }], address: null },
        catalogPolicy: { kind: "search_allowlist", allowedEmbalagemIds },
    });
    turnState.prepareInvokedThisTurn = true;
    turnState.lastPrepareOutcome = { ok: prepared.ok, errors: prepared.errors };
    if (!prepared.draft) return false;
    turnState.currentDraft = mergePreparedDraftIntoCurrent(turnState.currentDraft, prepared.draft);
    return Boolean(prepared.ok && (turnState.currentDraft?.items.length ?? 0) > 0);
}

/**
 * Busca determinística no servidor (mesma tool `search_produtos`) quando o modelo
 * pediu search sob `tool_choice` de prepare — evita TOOL_FAILED / silêncio.
 */
export async function applyDeterministicSearchThenPrepareFallback(params: {
    admin: SupabaseClient;
    catalog: CatalogPort;
    orderDraft: OrderDraftPort;
    companyId: string;
    customerId: string | null;
    userText: string;
    turnState: TurnState;
}): Promise<string> {
    const { turnState } = params;
    if (!turnState.searchInvokedThisTurn) {
        const result = await runSearchProdutosForAi(
            { query: params.userText, categoryHint: null },
            {
                admin: params.admin,
                catalog: params.catalog,
                companyId: params.companyId,
                customerId: params.customerId,
                userText: params.userText,
            }
        );
        turnState.allowlistIds = unionAllowlistIds(turnState.allowlistIds, result.allowlistIds);
        turnState.emptySearchStreak = result.wasEmpty ? turnState.emptySearchStreak + 1 : 0;
        if (result.wasEmpty) turnState.matchingMetrics.searchHitsZero += 1;
        turnState.searchInvokedThisTurn = true;
        turnState.searchCallCount += 1;
        turnState.searchedProductQueriesThisTurn = [
            ...turnState.searchedProductQueriesThisTurn,
            params.userText,
        ];
        const matched = matchWorklistLineForSearch({
            worklist: turnState.orderWorklist,
            query: params.userText,
        });
        const hitCount = result.wasEmpty ? 0 : result.allowlistIds.length;
        const productKey = result.pendingPickGroup?.productKey ?? null;
        const uniqueId = hitCount === 1 ? result.allowlistIds[0] ?? null : null;
        turnState.orderWorklist = advanceWorklistAfterSearch({
            worklist: turnState.orderWorklist,
            query: params.userText,
            hitCount: result.pendingPickGroup ? Math.max(hitCount, 2) : hitCount,
            productKey,
            produtoEmbalagemId: uniqueId,
            lineId: matched?.id ?? null,
        });
        if (result.pendingPickGroup) {
            turnState.pendingPickGroups = upsertPendingPickGroup(
                turnState.pendingPickGroups,
                {
                    ...result.pendingPickGroup,
                    lineId:
                        matched?.id ??
                        result.pendingPickGroup.lineId ??
                        `fb_${result.pendingPickGroup.productKey}`,
                }
            );
            turnState.lastSearchPicks = [];
        } else if (turnState.pendingPickGroups.length > 0) {
            turnState.lastSearchPicks = [];
        } else {
            turnState.lastSearchPicks = result.lastSearchPicks;
        }
    }
    await applySearchFallbackPrepareIfQtyKnown({
        orderDraft: params.orderDraft,
        companyId: params.companyId,
        customerId: params.customerId,
        userText: params.userText,
        turnState,
    });
    return buildSearchPicksFallbackReply(
        turnState.lastSearchPicks,
        turnState.pendingPickGroups,
        params.userText
    );
}

export class AiServiceAdapter implements AiService {
    private readonly catalog: CatalogPort;
    private readonly orderDraft: OrderDraftPort;
    private readonly sessionMemory: SessionMemoryPort;
    private readonly orderLinesExtract: OrderLinesExtractPort;
    private readonly modelOverride?: LanguageModel;
    private readonly providerOverride?: LlmProviderName;
    private readonly modelNameOverride?: string;
    private readonly onCircuitStateChange?: (e: CircuitStateChangeEvent) => void;
    private readonly metrics?: MetricsPort;

    constructor(private readonly admin: SupabaseClient, opts?: AiServiceOptions) {
        this.catalog = opts?.catalog ?? new SupabaseCatalogAdapter(admin);
        this.orderDraft = opts?.orderDraft ?? new SupabaseOrderDraftAdapter(admin);
        this.sessionMemory = opts?.sessionMemory ?? new NoopSessionMemoryAdapter();
        this.orderLinesExtract =
            opts?.orderLinesExtract ??
            (opts?.model
                ? new FakeOrderLinesExtractAdapter()
                : new LlmOrderLinesExtractAdapter());
        this.modelOverride = opts?.model;
        this.providerOverride = opts?.providerOverride;
        this.modelNameOverride = opts?.modelNameOverride;
        this.onCircuitStateChange = opts?.onCircuitStateChange;
        this.metrics = opts?.metrics;
    }

    private buildProviderError(input: AiServiceInput, toolRoundsUsed: number, allowlistIds: string[]): AiServiceResult {
        return {
            action: "error",
            replyText: "Tive uma falha ao processar sua mensagem. Pode tentar novamente?",
            updatedDraft: input.draft,
            updatedHistory: input.history,
            updatedSearchProdutoEmbalagemIds: allowlistIds,
            signals: { toolRoundsUsed, intentMarker: "unknown" },
            errorCode: "AI_PROVIDER_ERROR",
        };
    }

    private async buildSuccess(
        input: AiServiceInput,
        replyText: string,
        marker: IntentMarker,
        toolRoundsUsed: number,
        updatedDraft: OrderDraft | null,
        turn: {
            allowlistIds: string[];
            lastSearchPicks: SearchPickSummary[];
            emptySearchStreak: number;
            addressFreeText: boolean;
            orderWorklist: OrderWorklist;
            pendingPickGroups: PendingPickGroup[];
            matchingMetrics?: { prepareBlockedAllowlist: number; searchHitsZero: number };
        }
    ): Promise<AiServiceResult> {
        const nextHistoryRaw = buildNextHistory(input, replyText);
        const compacted = await this.sessionMemory.compactIfNeeded({
            history: nextHistoryRaw,
            existingSummary: input.context.session.aiHistorySummary ?? null,
        });
        const nextHistory = compacted.history;
        const nextSummary = compacted.summary;
        const addrUiOk = input.context.session.deliveryAddressUiConfirmed === true;
        const matchingSignals =
            turn.matchingMetrics &&
            (turn.matchingMetrics.prepareBlockedAllowlist > 0 ||
                turn.matchingMetrics.searchHitsZero > 0)
                ? { matchingMetrics: turn.matchingMetrics }
                : {};

        if (shouldEscalate(input, marker)) {
            return {
                action: "escalate",
                replyText:
                    replyText ||
                    "Não estou conseguindo entender bem. Você prefere catálogo, atendente ou tentar de novo?",
                updatedDraft,
                updatedHistory: nextHistory,
                updatedAiHistorySummary: nextSummary,
                updatedSearchProdutoEmbalagemIds: turn.allowlistIds,
                lastSearchPicks: turn.lastSearchPicks,
                emptySearchStreak: turn.emptySearchStreak,
                updatedOrderWorklist: turn.orderWorklist,
                updatedPendingPickGroups: turn.pendingPickGroups,
                signals: {
                    toolRoundsUsed,
                    intentMarker: marker,
                    addressFreeText: turn.addressFreeText,
                    ...matchingSignals,
                },
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
            updatedAiHistorySummary: nextSummary,
            updatedSearchProdutoEmbalagemIds: turn.allowlistIds,
            lastSearchPicks: turn.lastSearchPicks,
            emptySearchStreak: turn.emptySearchStreak,
            updatedOrderWorklist: turn.orderWorklist,
            updatedPendingPickGroups: turn.pendingPickGroups,
            signals: {
                toolRoundsUsed,
                intentMarker: marker,
                addressFreeText: turn.addressFreeText,
                ...matchingSignals,
            },
        };
    }

    async run(input: AiServiceInput): Promise<AiServiceResult> {
        const session = input.context.session;
        const pickResolveTurn =
            typeof (input.context as { pickResolveTurn?: unknown }).pickResolveTurn === "boolean"
                ? Boolean((input.context as { pickResolveTurn?: boolean }).pickResolveTurn)
                : undefined;
        const turnState: TurnState = createInitialTurnState({
            allowlistIds: session.searchProdutoEmbalagemIds ?? [],
            lastSearchPicks: session.lastSearchPicks ?? [],
            emptySearchStreak: session.emptySearchStreak ?? 0,
            currentDraft: input.draft,
            pendingOrderMentions: session.pendingOrderMentions ?? [],
            orderWorklist: session.orderWorklist,
            pendingPickGroups: session.pendingPickGroups ?? [],
            ...(pickResolveTurn !== undefined ? { pickResolveTurn } : {}),
        });
        const allowlistAtStart = [...turnState.allowlistIds];
        /**
         * Só força `resolve_pending_picks` para grupos que JÁ existiam no início do turno
         * (carryover — o servidor já mandou a pergunta em texto livre num turno anterior e
         * o resolvedor determinístico, `serverResolvePendingPicksFromFreeText`, não fechou
         * 100%). Um grupo criado agora mesmo por `search_produtos` NESTE turno não pode ser
         * forçado — o cliente ainda nem viu a pergunta; forçar aqui faz o modelo "chutar"
         * uma embalagem sem o cliente ter respondido nada (bug real do smoke S2).
         */
        const carryoverPendingPickKeys = new Set(
            (session.pendingPickGroups ?? []).map((g) => g.productKey)
        );

        const infoOnly = isInfoOnlyAi(input);
        const hasActiveWorklistLines =
            listLinesByStatus(turnState.orderWorklist, "pending_search").length > 0 ||
            listLinesByStatus(turnState.orderWorklist, "ambiguous").length > 0 ||
            listLinesByStatus(turnState.orderWorklist, "awaiting_qty").length > 0;
        if (!infoOnly && !hasActiveWorklistLines && input.intentDecision.intent === "order_intent") {
            turnState.orderWorklist = await seedWorklistFromExtract({
                previous: turnState.orderWorklist,
                userText: input.userText,
                extractPort: this.orderLinesExtract,
                fallbackExtracted: extractCandidatePendingTermsFromUserText(input.userText).map(
                    (rawTerm) => ({ rawTerm })
                ),
            });
        }

        if (!this.modelOverride && !hasLlmApiKey(this.providerOverride)) {
            return {
                action: "error",
                replyText: "Estou sem conexão com IA agora. Pode tentar novamente em instantes?",
                updatedDraft: input.draft,
                updatedHistory: input.history,
                updatedSearchProdutoEmbalagemIds: turnState.allowlistIds,
                lastSearchPicks: turnState.lastSearchPicks,
                emptySearchStreak: turnState.emptySearchStreak,
                updatedOrderWorklist: turnState.orderWorklist,
                signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                errorCode: "AI_PROVIDER_ERROR",
            };
        }

        const companyId = input.context.tenant.companyId;

        try {
            const model =
                this.modelOverride ??
                resolveLanguageModel({ provider: this.providerOverride, model: this.modelNameOverride });
            const provider = this.providerOverride ?? getConfiguredLlmProviderName();

            const promptCacheOn = isLlmPromptCacheEnabled(provider);
            const { stableSystem, dynamicContext } = buildPromptPartsForCache(input);
            const respondToCustomerTool = createRespondToCustomerTool({
                anthropicCache: promptCacheOn,
            });
            const searchTool = createSearchProdutosTool({
                admin: this.admin,
                catalog: this.catalog,
                companyId,
                customerId: input.context.session.customerId,
                userText: input.userText,
                turnState,
            });
            const hintsTool = createGetOrderHintsTool({
                admin: this.admin,
                companyId,
                phoneE164: input.context.tenant.phoneE164,
                profileName: input.context.actor.profileName ?? null,
                prefetchedOrderHints: input.context.prefetchedOrderHints,
            });

            const tools = {
                search_produtos: searchTool,
                get_order_hints: hintsTool,
                prepare_order_draft: createPrepareOrderDraftTool({
                    admin: this.admin,
                    orderDraft: this.orderDraft,
                    companyId,
                    threadId: input.context.tenant.threadId,
                    customerId: input.context.session.customerId,
                    profileName: input.context.actor.profileName ?? null,
                    phoneE164: input.context.tenant.phoneE164,
                    userText: input.userText,
                    turnState,
                    onPrepareDraftToolResult: input.onPrepareDraftToolResult,
                    disabled: infoOnly,
                }),
                resolve_pending_picks: createResolvePendingPicksTool({
                    orderDraft: this.orderDraft,
                    companyId,
                    customerId: input.context.session.customerId,
                    turnState,
                    disabled: infoOnly,
                }),
                respond_to_customer: respondToCustomerTool,
            };

            /**
             * Prompt cache Anthropic (ADR-0003 §9.3):
             * - system = só prefixo estável (rules)
             * - breakpoint em `respond_to_customer` (última tool) → cacheia system+tools
             *   (Haiku 4.5 exige ≥4096 tokens; tools sozinhas fecham o mínimo)
             * - draft/worklist/hints no user — fora do prefixo, senão miss a cada turno
             */
            const userInbound = wrapUserInboundForLlm(input.userText);
            const historyMsgs = historyToModelMessages(
                input.history,
                input.limits.maxHistoryTurns
            );
            const system = promptCacheOn
                ? stableSystem
                : stableSystem + dynamicContext;
            const messages = [
                ...historyMsgs,
                {
                    role: "user" as const,
                    content:
                        promptCacheOn && dynamicContext
                            ? `${dynamicContext}\n\n--- Mensagem do cliente ---\n${userInbound}`
                            : userInbound,
                },
            ];

            const shouldForcePrepare = (): boolean => {
                if (infoOnly || input.skipForcePrepareAfterPick) return false;
                return (
                    shouldForcePrepareAfterEmbalagemChoice({
                        intent: input.intentDecision.intent,
                        step: input.context.session.step,
                        allowlistAtStart,
                        allowlistNow: turnState.allowlistIds,
                        prepareInvokedThisTurn: turnState.prepareInvokedThisTurn,
                        draftItemCount: turnState.currentDraft?.items?.length ?? 0,
                    }) ||
                    shouldForcePrepareAfterUnambiguousSearch({
                        intent: input.intentDecision.intent,
                        step: input.context.session.step,
                        prepareInvokedThisTurn: turnState.prepareInvokedThisTurn,
                        searchInvokedThisTurn: turnState.searchInvokedThisTurn,
                        allowlistNowCount: turnState.allowlistIds.length,
                        pendingAllowlistNotInDraftCount: countAllowlistIdsNotInDraft(
                            turnState.allowlistIds,
                            turnState.currentDraft
                        ),
                        userText: input.userText,
                        pendingPickGroupsCount: turnState.pendingPickGroups.length,
                        lastSearchPicksCount: turnState.lastSearchPicks.length,
                        pendingSearchTermsCount: pendingSearchTermsFromWorklist(
                            turnState.orderWorklist
                        ).length,
                    })
                );
            };

            /**
             * Produto(s) do cliente ainda não buscado(s) — lines `pending_search` na worklist
             * (ADR 0011). Não force-search no turno de pick já listado (`pickResolveTurn`).
             */
            const shouldForcePendingSearch = (): boolean => {
                if (infoOnly) return false;
                return shouldForceSearchWorklist({
                    worklist: turnState.orderWorklist,
                    pickResolveTurn: turnState.pickResolveTurn,
                });
            };

            const carryoverPendingPickGroups = (): PendingPickGroup[] =>
                turnState.pendingPickGroups.filter((g) => carryoverPendingPickKeys.has(g.productKey));

            const shouldForcePendingPicks = (): boolean =>
                shouldForceResolvePendingPicks({
                    infoOnly,
                    pendingPickGroups: carryoverPendingPickGroups(),
                });

            const firstToolChoice =
                !infoOnly && input.preferPrepareToolChoiceFirst
                    ? ({ type: "tool" as const, toolName: "prepare_order_draft" as const })
                    : undefined;
            const maxSteps = Math.max(2, input.limits.maxToolRounds + 5);

            const result = await runLlmWithResilience(
                provider,
                () =>
                generateText({
                    model,
                    system,
                    messages,
                    tools,
                    toolChoice: "required",
                    /** B13: teto de output por turno — evita flood de tokens / custo. */
                    maxOutputTokens: 2_048,
                    /**
                     * Retry do SDK em cima do mesmo AbortSignal queima o orçamento do turno
                     * (ex.: tool-choice fail → sleep → "Delay was aborted" → AI_TIMEOUT).
                     * Rate-limit 429 já é tratado por `runLlmWithResilience`.
                     */
                    maxRetries: 0,
                    abortSignal: AbortSignal.timeout(input.limits.timeoutMs),
                    /**
                     * Groq/OpenAI às vezes mandam `null` em arrays (ex.: items, picks,
                     * outros_produtos_pendentes legado). Sem repair o generateText aborta.
                     * Docs AI SDK: experimental_repairToolCall + InvalidToolInputError.
                     */
                    experimental_repairToolCall: async ({ toolCall, error }) => {
                        if (NoSuchToolError.isInstance(error)) return null;
                        if (!InvalidToolInputError.isInstance(error)) return null;
                        let args: Record<string, unknown>;
                        try {
                            args =
                                typeof toolCall.input === "string"
                                    ? (JSON.parse(toolCall.input) as Record<string, unknown>)
                                    : (toolCall.input as Record<string, unknown>);
                        } catch {
                            return null;
                        }
                        if (!args || typeof args !== "object") return null;
                        const next: Record<string, unknown> = { ...args };
                        let changed = false;
                        for (const [k, v] of Object.entries(next)) {
                            if (v !== null) continue;
                            if (
                                k === "outros_produtos_pendentes" ||
                                k === "items" ||
                                k === "picks"
                            ) {
                                next[k] = [];
                                changed = true;
                            }
                        }
                        if (!changed) return null;
                        console.warn("[ai.service] repairToolCall null→[]", {
                            toolName: toolCall.toolName,
                            keys: Object.keys(next).filter((k) => next[k] !== args[k]),
                        });
                        return { ...toolCall, input: JSON.stringify(next) };
                    },
                    /**
                     * `respond_to_customer` é obrigatoriamente a última tool do turno — sem isso o
                     * modelo pode devolvê-la junto de `search_produtos`/`prepare_order_draft` no
                     * mesmo step (rodam em paralelo via `Promise.all`) e a resposta ao cliente sairia
                     * sem ver o resultado da tool de negócio. `disableParallelToolUse` é exclusivo da
                     * Anthropic; `parallelToolCalls: false` é o equivalente na OpenAI — sem isso o
                     * mesmo bug ocorreria pra empresas com `llm_provider="openai"`.
                     */
                    providerOptions:
                        provider === "anthropic"
                            ? { anthropic: { disableParallelToolUse: true } }
                            : provider === "groq"
                              ? ({
                                    groq: {
                                        parallelToolCalls: false,
                                        reasoningEffort: "low",
                                    },
                                } satisfies { groq: GroqLanguageModelOptions })
                              : {
                                    openai: {
                                        parallelToolCalls: false,
                                        reasoningEffort: "minimal",
                                        textVerbosity: "low",
                                    } satisfies OpenAILanguageModelResponsesOptions,
                                },
                    stopWhen: [
                        ({ steps }) => {
                            if (!lastStepCalledRespond(steps)) return false;
                            const searchPendingDone = !shouldForcePendingSearch();
                            const prepareDone = !shouldForcePrepare() || turnState.forcePrepareNudgeInjected;
                            const pendingPicksDone =
                                !shouldForcePendingPicks() || turnState.forceResolvePendingPicksNudgeInjected;
                            return searchPendingDone && prepareDone && pendingPicksDone;
                        },
                        stepCountIs(maxSteps),
                    ],
                    prepareStep: async ({ stepNumber, steps, messages: stepMessages }) => {
                        if (stepNumber === 0 && firstToolChoice) {
                            return { toolChoice: firstToolChoice };
                        }

                        const respondedOnLastStep = lastStepCalledRespond(steps);

                        const forcePendingSearchStep = () => {
                            const withNudge = !turnState.forceSearchPendingNudgeInjected;
                            turnState.forceSearchPendingNudgeInjected = true;
                            return {
                                toolChoice: {
                                    type: "tool" as const,
                                    toolName: "search_produtos" as const,
                                },
                                messages: withNudge
                                    ? [
                                          ...stepMessages,
                                          {
                                              role: "user" as const,
                                              content: buildForceSearchPendingNudge(
                                                  pendingSearchTermsFromWorklist(
                                                      turnState.orderWorklist
                                                  )
                                              ),
                                          },
                                      ]
                                    : stepMessages,
                            };
                        };

                        const forceResolvePendingPicksStep = () => ({
                            toolChoice: { type: "tool" as const, toolName: "resolve_pending_picks" as const },
                            messages: [
                                ...stepMessages,
                                {
                                    role: "user" as const,
                                    content: buildForceResolvePendingPicksNudge(carryoverPendingPickGroups()),
                                },
                            ],
                        });

                        const forcePrepareStep = () => ({
                            toolChoice: { type: "tool" as const, toolName: "prepare_order_draft" as const },
                            messages: [...stepMessages, { role: "user" as const, content: FORCE_PREPARE_NUDGE }],
                        });

                        /**
                         * Fase A — respond ainda não foi chamado neste step: após search/prepare/
                         * resolve neste turno, força `respond_to_customer` (Groq/gpt-oss devolve
                         * texto puro com toolChoice=required). Não força search/prepare/picks aqui —
                         * isso é Fase B, só depois que o modelo tentou fechar cedo demais.
                         */
                        if (!respondedOnLastStep) {
                            if (
                                stepNumber > 0 &&
                                stepsHadBusinessTool(steps) &&
                                !shouldForcePendingSearch() &&
                                !shouldForcePendingPicks() &&
                                !shouldForcePrepare()
                            ) {
                                return {
                                    toolChoice: {
                                        type: "tool" as const,
                                        toolName: "respond_to_customer" as const,
                                    },
                                };
                            }
                            return undefined;
                        }

                        /**
                         * Fase B — respond foi chamado cedo demais: força mais trabalho de negócio
                         * antes de permitir stopWhen encerrar o turno.
                         */
                        if (shouldForcePendingSearch()) {
                            return forcePendingSearchStep();
                        }
                        if (!turnState.forceResolvePendingPicksNudgeInjected && shouldForcePendingPicks()) {
                            turnState.forceResolvePendingPicksNudgeInjected = true;
                            return forceResolvePendingPicksStep();
                        }
                        if (!turnState.forcePrepareNudgeInjected && shouldForcePrepare()) {
                            turnState.forcePrepareNudgeInjected = true;
                            return forcePrepareStep();
                        }
                        return undefined;
                    },
                    onStepFinish: async (step) => {
                        const modelId = step.response.modelId?.trim() || "unknown";
                        const inputTokens = step.usage.inputTokens ?? 0;
                        const outputTokens = step.usage.outputTokens ?? 0;
                        const cacheReadTokens =
                            step.usage.inputTokenDetails?.cacheReadTokens ?? 0;
                        const cacheWriteTokens =
                            step.usage.inputTokenDetails?.cacheWriteTokens ?? 0;
                        if (promptCacheOn && (cacheReadTokens > 0 || cacheWriteTokens > 0)) {
                            console.info("[ai.service] prompt_cache", {
                                companyId,
                                model: modelId,
                                cacheReadTokens,
                                cacheWriteTokens,
                                inputTokens,
                                outputTokens,
                            });
                        }
                        await debitFromAnthropicUsage(
                            this.admin,
                            companyId,
                            {
                                input_tokens: inputTokens,
                                output_tokens: outputTokens,
                            },
                            {
                                source: "pro_ai_service",
                                provider,
                                model: modelId,
                                ...(promptCacheOn
                                    ? {
                                          cache_read_tokens: cacheReadTokens,
                                          cache_write_tokens: cacheWriteTokens,
                                      }
                                    : {}),
                            }
                        );
                        if (this.metrics) {
                            const tags = { companyId, provider, model: modelId };
                            if (inputTokens > 0) {
                                this.metrics.increment("pro_pipeline.ai_tokens_in", inputTokens, tags);
                            }
                            if (outputTokens > 0) {
                                this.metrics.increment("pro_pipeline.ai_tokens_out", outputTokens, tags);
                            }
                            if (cacheReadTokens > 0) {
                                this.metrics.increment(
                                    "pro_pipeline.ai_cache_read_tokens",
                                    cacheReadTokens,
                                    tags
                                );
                            }
                            if (cacheWriteTokens > 0) {
                                this.metrics.increment(
                                    "pro_pipeline.ai_cache_write_tokens",
                                    cacheWriteTokens,
                                    tags
                                );
                            }
                        }
                    },
                }),
                { onCircuitStateChange: this.onCircuitStateChange, companyId }
            );

            const finalRespondCall = result.toolCalls.find((c) => c.toolName === "respond_to_customer");
            if (!finalRespondCall) {
                return {
                    action: "error",
                    replyText:
                        "Atingimos o limite de consultas automáticas nesta mensagem. Pode repetir o pedido de forma mais curta ou em partes?",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    updatedSearchProdutoEmbalagemIds: turnState.allowlistIds,
                    signals: { toolRoundsUsed: result.steps.length, intentMarker: "unknown" },
                    errorCode: "TOOL_FAILED",
                };
            }

            const respondArgs = finalRespondCall.input as {
                reply_text?: string;
                address_free_text?: boolean;
                understood?: boolean;
            };
            const addressFreeText = Boolean(respondArgs.address_free_text);
            const marker: IntentMarker = respondArgs.understood === false ? "unknown" : "ok";
            const updatedDraft = turnState.currentDraft;

            let visibleSafe = stripInternalCatalogIdsFromCustomerText(
                stripHallucinatedOrderPersistenceClaims(
                    sanitizeVisibleAgainstDraft(String(respondArgs.reply_text ?? "").trim(), updatedDraft),
                    {
                        draftComplete: Boolean(updatedDraft && isDraftStructurallyCompleteForFinalize(updatedDraft)),
                        hasDraftItems: Boolean(updatedDraft?.items?.length),
                    }
                )
            );
            const hasDraftItems = Boolean(updatedDraft?.items?.length);
            const prepOk = turnState.lastPrepareOutcome?.ok ?? null;
            const prepErrs = turnState.lastPrepareOutcome?.errors ?? [];
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

            const toolRoundsUsed = Math.max(0, result.steps.length - 1);
            return await this.buildSuccess(input, visibleSafe, marker, toolRoundsUsed, updatedDraft, {
                allowlistIds: turnState.allowlistIds,
                lastSearchPicks: turnState.lastSearchPicks,
                emptySearchStreak: turnState.emptySearchStreak,
                addressFreeText,
                orderWorklist: turnState.orderWorklist,
                pendingPickGroups: turnState.pendingPickGroups,
                matchingMetrics: { ...turnState.matchingMetrics },
            });
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            const errName = error instanceof Error ? error.name : typeof error;
            console.warn("[ai.service] generateText failed", {
                companyId,
                provider: this.providerOverride ?? getConfiguredLlmProviderName(),
                errName,
                errMsg: errMsg.slice(0, 500),
                invalidToolInput: InvalidToolInputError.isInstance(error),
                allowlistSize: turnState.allowlistIds.length,
            });
            if (error instanceof LlmProviderConfigError) {
                return this.buildProviderError(input, 0, turnState.allowlistIds);
            }
            if (isTimeoutError(error)) {
                if (
                    turnState.searchInvokedThisTurn &&
                    (turnState.lastSearchPicks.length > 0 || turnState.pendingPickGroups.length > 0)
                ) {
                    console.warn("[ai.service] timeout fallback after search", {
                        companyId,
                        pickCount: turnState.lastSearchPicks.length,
                        pendingGroups: turnState.pendingPickGroups.length,
                    });
                    await applySearchFallbackPrepareIfQtyKnown({
                        orderDraft: this.orderDraft,
                        companyId,
                        customerId: input.context.session.customerId,
                        userText: input.userText,
                        turnState,
                    });
                    const fallbackText = buildSearchPicksFallbackReply(
                        turnState.lastSearchPicks,
                        turnState.pendingPickGroups,
                        input.userText
                    );
                    return await this.buildSuccess(
                        input,
                        fallbackText,
                        "ok",
                        1,
                        turnState.pendingPickGroups.length > 0
                            ? input.draft
                            : (turnState.currentDraft ?? input.draft),
                        {
                        allowlistIds: turnState.allowlistIds,
                        lastSearchPicks: turnState.lastSearchPicks,
                        emptySearchStreak: turnState.emptySearchStreak,
                        addressFreeText: false,
                        orderWorklist: turnState.orderWorklist,
                        pendingPickGroups: turnState.pendingPickGroups,
                    });
                }
                return {
                    action: "error",
                    replyText: "A IA demorou para responder. Tente novamente em instantes.",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    updatedSearchProdutoEmbalagemIds: turnState.allowlistIds,
                    signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                    errorCode: "AI_TIMEOUT",
                };
            }
            if (isRateLimitError(error)) {
                return {
                    action: "error",
                    replyText: "Estamos com pico de uso na IA. Aguarde um instante e tente de novo.",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    updatedSearchProdutoEmbalagemIds: turnState.allowlistIds,
                    signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                    errorCode: "AI_RATE_LIMIT",
                };
            }
            if (isToolChoiceMismatchError(error)) {
                console.warn("[ai.service] tool_choice mismatch — busca determinística", {
                    companyId,
                    errMsg: errMsg.slice(0, 240),
                    allowlistSize: turnState.allowlistIds.length,
                });
                const fallbackText = await applyDeterministicSearchThenPrepareFallback({
                    admin: this.admin,
                    catalog: this.catalog,
                    orderDraft: this.orderDraft,
                    companyId,
                    customerId: input.context.session.customerId,
                    userText: input.userText,
                    turnState,
                });
                return await this.buildSuccess(
                    input,
                    fallbackText,
                    "ok",
                    1,
                    turnState.pendingPickGroups.length > 0
                        ? input.draft
                        : (turnState.currentDraft ?? input.draft),
                    {
                        allowlistIds: turnState.allowlistIds,
                        lastSearchPicks: turnState.lastSearchPicks,
                        emptySearchStreak: turnState.emptySearchStreak,
                        addressFreeText: false,
                        orderWorklist: turnState.orderWorklist,
                        pendingPickGroups: turnState.pendingPickGroups,
                    }
                );
            }
            if (InvalidToolInputError.isInstance(error) || isToolCallSchemaValidationError(error)) {
                if (
                    turnState.searchInvokedThisTurn &&
                    (turnState.lastSearchPicks.length > 0 || turnState.pendingPickGroups.length > 0)
                ) {
                    console.warn("[ai.service] tool schema fallback after search", {
                        companyId,
                        pickCount: turnState.lastSearchPicks.length,
                        pendingGroups: turnState.pendingPickGroups.length,
                        errMsg: errMsg.slice(0, 200),
                    });
                    await applySearchFallbackPrepareIfQtyKnown({
                        orderDraft: this.orderDraft,
                        companyId,
                        customerId: input.context.session.customerId,
                        userText: input.userText,
                        turnState,
                    });
                    const fallbackText = buildSearchPicksFallbackReply(
                        turnState.lastSearchPicks,
                        turnState.pendingPickGroups,
                        input.userText
                    );
                    return await this.buildSuccess(
                        input,
                        fallbackText,
                        "ok",
                        1,
                        turnState.pendingPickGroups.length > 0
                            ? input.draft
                            : (turnState.currentDraft ?? input.draft),
                        {
                            allowlistIds: turnState.allowlistIds,
                            lastSearchPicks: turnState.lastSearchPicks,
                            emptySearchStreak: turnState.emptySearchStreak,
                            addressFreeText: false,
                            orderWorklist: turnState.orderWorklist,
                            pendingPickGroups: turnState.pendingPickGroups,
                        }
                    );
                }
                return {
                    action: "error",
                    replyText:
                        "Não consegui montar a consulta automática nesta mensagem. Pode repetir de forma mais curta?",
                    updatedDraft: input.draft,
                    updatedHistory: input.history,
                    updatedSearchProdutoEmbalagemIds: turnState.allowlistIds,
                    signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                    errorCode: "TOOL_FAILED",
                };
            }
            if (isModelSkippedRequiredToolError(error) && turnState.searchInvokedThisTurn) {
                console.warn("[ai.service] fallback reply after search without respond_to_customer", {
                    companyId,
                    pickCount: turnState.lastSearchPicks.length,
                    pendingGroups: turnState.pendingPickGroups.length,
                });
                await applySearchFallbackPrepareIfQtyKnown({
                    orderDraft: this.orderDraft,
                    companyId,
                    customerId: input.context.session.customerId,
                    userText: input.userText,
                    turnState,
                });
                const fallbackText = buildSearchPicksFallbackReply(
                    turnState.lastSearchPicks,
                    turnState.pendingPickGroups,
                    input.userText
                );
                return await this.buildSuccess(input, fallbackText, "ok", 1, turnState.currentDraft ?? input.draft, {
                    allowlistIds: turnState.allowlistIds,
                    lastSearchPicks: turnState.lastSearchPicks,
                    emptySearchStreak: turnState.emptySearchStreak,
                    addressFreeText: false,
                    orderWorklist: turnState.orderWorklist,
                    pendingPickGroups: turnState.pendingPickGroups,
                });
            }
            return this.buildProviderError(input, 0, turnState.allowlistIds);
        }
    }
}
