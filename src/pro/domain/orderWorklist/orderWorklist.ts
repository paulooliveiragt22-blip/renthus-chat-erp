/**
 * OrderWorklist — fonte canônica de linhas de pedido em coleta (ADR 0011).
 * Lifecycle só no servidor; extract LLM só (re)semeia quando o hash muda.
 */
import type {
    OrderWorklist,
    OrderWorklistLine,
    OrderWorklistLineStatus,
} from "@/src/types/contracts";

export const MAX_WORKLIST_LINES = 15;
export const MAX_SEARCH_ATTEMPTS_PER_LINE = 2;

const BLOCKING_STATUSES: ReadonlySet<OrderWorklistLineStatus> = new Set([
    "pending_search",
    "searching",
    "ambiguous",
    "awaiting_qty",
]);

export function createEmptyOrderWorklist(nowIso?: string): OrderWorklist {
    return {
        lines: [],
        sealedFromUserTextHash: null,
        updatedAtIso: nowIso ?? null,
    };
}

export function newWorklistLineId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `wl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Hash estável não-criptográfico do inbound (selo de extract). */
export function hashUserTextForSeal(userText: string): string {
    const s = String(userText ?? "").normalize("NFKC").trim().toLowerCase();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return `fnv1a_${(h >>> 0).toString(16)}`;
}

export function normalizeWorklistTerm(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

const QTY_LIKE_TOKENS = new Set([
    "um",
    "uma",
    "uns",
    "umas",
    "dois",
    "duas",
    "tres",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
]);

const SIZE_VARIANT_TOKENS = new Set(["p", "m", "g", "gg", "xg", "pp"]);

function tokensHaveQtyLike(tokens: readonly string[]): boolean {
    return tokens.some((t) => QTY_LIKE_TOKENS.has(t) || /^\d+$/.test(t));
}

export function termsReferToSame(a: string, b: string): boolean {
    const na = normalizeWorklistTerm(a);
    const nb = normalizeWorklistTerm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    /**
     * Não usar `includes` solto: "skol" ⊆ "skol tres caixa de jamel" colapsava
     * jamel no merge lexical (smoke multi-item).
     * Mono-token casa em frase curta de produto; se o outro lado tem qty
     * embutida, é blob multi-item — não é o mesmo termo.
     */
    const allA = na.split(" ").filter(Boolean);
    const allB = nb.split(" ").filter(Boolean);
    /** "marmitas m" ≠ "marmitas g" — tamanho curto não pode ser descartado. */
    const sizeA = allA.filter((t) => SIZE_VARIANT_TOKENS.has(t));
    const sizeB = allB.filter((t) => SIZE_VARIANT_TOKENS.has(t));
    if (sizeA.length && sizeB.length && sizeA.join("|") !== sizeB.join("|")) {
        return false;
    }

    const ta = allA.filter((t) => t.length >= 3);
    const tb = allB.filter((t) => t.length >= 3);
    if (ta.length === 1 && tb.includes(ta[0]!)) {
        if (tb.length === 1) return true;
        if (tokensHaveQtyLike(allB)) return false;
        return true;
    }
    if (tb.length === 1 && ta.includes(tb[0]!)) {
        if (ta.length === 1) return true;
        if (tokensHaveQtyLike(allA)) return false;
        return true;
    }
    return false;
}

/** Termo inventado pela IA: deve aparecer como substring do userText normalizado. */
export function termAppearsInUserText(rawTerm: string, userText: string): boolean {
    const term = normalizeWorklistTerm(rawTerm);
    const hay = normalizeWorklistTerm(userText);
    if (!term || term.length < 2 || !hay) return false;
    return hay.includes(term);
}

export type ExtractedOrderLineInput = {
    rawTerm: string;
    quantity?: number | null;
};

function buildPendingLineFromExtract(
    row: ExtractedOrderLineInput
): OrderWorklistLine | null {
    const rawTerm = String(row.rawTerm ?? "").trim();
    if (!rawTerm) return null;
    const qty =
        row.quantity != null && Number.isFinite(row.quantity) && row.quantity >= 1
            ? Math.floor(Number(row.quantity))
            : null;
    return {
        id: newWorklistLineId(),
        rawTerm,
        quantity: qty,
        status: "pending_search",
        searchAttempts: 0,
        productKey: null,
        produtoEmbalagemId: null,
        lastQuery: null,
        pendingPickGroupKey: null,
    };
}

/**
 * Selo / reseed da worklist a partir de extract estruturado.
 * Mesmo hash: no-op se nada faltando; se o extract/lexical trouxe termos a mais
 * (selo incompleto anterior), enriquece sem apagar progresso (skol/jamel/whisk).
 */
export function sealWorklistFromExtract(params: {
    previous: OrderWorklist | null | undefined;
    userText: string;
    extracted: readonly ExtractedOrderLineInput[];
    nowIso?: string;
}): OrderWorklist {
    const hash = hashUserTextForSeal(params.userText);
    const prev = params.previous;
    const nowIso = params.nowIso ?? new Date().toISOString();

    const candidateLines: OrderWorklistLine[] = [];
    for (const row of params.extracted) {
        const rawTerm = String(row.rawTerm ?? "").trim();
        if (!rawTerm) continue;
        if (!termAppearsInUserText(rawTerm, params.userText)) continue;
        if (candidateLines.some((l) => termsReferToSame(l.rawTerm, rawTerm))) continue;
        const line = buildPendingLineFromExtract(row);
        if (!line) continue;
        candidateLines.push(line);
        if (candidateLines.length >= MAX_WORKLIST_LINES) break;
    }

    if (prev?.sealedFromUserTextHash === hash && (prev.lines?.length ?? 0) > 0) {
        const missing = candidateLines.filter(
            (c) => !prev.lines.some((l) => termsReferToSame(l.rawTerm, c.rawTerm))
        );
        if (missing.length === 0) return prev;
        const room = Math.max(0, MAX_WORKLIST_LINES - prev.lines.length);
        if (room === 0) return prev;
        return {
            ...prev,
            lines: [...prev.lines, ...missing.slice(0, room)],
            updatedAtIso: nowIso,
        };
    }

    /**
     * Extract vazio / filtrado não pode apagar carryover (ADR 0011):
     * IA/`[]` não é overwrite da worklist.
     */
    if (candidateLines.length === 0) {
        if (prev && (prev.lines?.length ?? 0) > 0) return prev;
        return {
            lines: [],
            sealedFromUserTextHash: hash,
            updatedAtIso: nowIso,
        };
    }

    return {
        lines: candidateLines,
        sealedFromUserTextHash: hash,
        updatedAtIso: nowIso,
    };
}

/** Hydrate one-shot de menções string legadas → worklist. */
export function hydrateWorklistFromLegacyMentions(params: {
    mentions: readonly string[];
    existing?: OrderWorklist | null;
    nowIso?: string;
}): OrderWorklist {
    if (params.existing && params.existing.lines.length > 0) {
        return params.existing;
    }
    const extracted = (params.mentions ?? [])
        .map((t) => String(t ?? "").trim())
        .filter(Boolean)
        .map((rawTerm) => ({ rawTerm, quantity: null as number | null }));
    if (extracted.length === 0) {
        return createEmptyOrderWorklist(params.nowIso);
    }
    return {
        lines: extracted.slice(0, MAX_WORKLIST_LINES).map((e) => ({
            id: newWorklistLineId(),
            rawTerm: e.rawTerm,
            quantity: null,
            status: "pending_search" as const,
            searchAttempts: 0,
            productKey: null,
            produtoEmbalagemId: null,
            lastQuery: null,
            pendingPickGroupKey: null,
        })),
        sealedFromUserTextHash: null,
        updatedAtIso: params.nowIso ?? new Date().toISOString(),
    };
}

export function worklistBlocksCheckout(wl: OrderWorklist | null | undefined): boolean {
    return (wl?.lines ?? []).some((l) => BLOCKING_STATUSES.has(l.status));
}

/**
 * Line `in_draft` na worklist sem o SKU no carrinho real → desync (ADR 0011).
 * Bloqueia checkout/fulfillment até prepare reconciliar.
 */
export function worklistHasOrphanInDraftLines(
    wl: OrderWorklist | null | undefined,
    draft: { items?: Array<{ produtoEmbalagemId?: string | null }> } | null | undefined
): boolean {
    const inCart = new Set(
        (draft?.items ?? [])
            .map((i) => String(i.produtoEmbalagemId ?? "").trim())
            .filter(Boolean)
    );
    return (wl?.lines ?? []).some((l) => {
        if (l.status !== "in_draft") return false;
        const id = String(l.produtoEmbalagemId ?? "").trim();
        if (!id) return true;
        return !inCart.has(id);
    });
}

/** Status bloqueantes + órfãos in_draft↔draft (use em gates de checkout). */
export function worklistPreventsCheckout(
    wl: OrderWorklist | null | undefined,
    draft?: { items?: Array<{ produtoEmbalagemId?: string | null }> } | null
): boolean {
    return worklistBlocksCheckout(wl) || worklistHasOrphanInDraftLines(wl, draft);
}

export function listLinesByStatus(
    wl: OrderWorklist | null | undefined,
    status: OrderWorklistLineStatus
): OrderWorklistLine[] {
    return (wl?.lines ?? []).filter((l) => l.status === status);
}

export function nextPendingSearchLine(
    wl: OrderWorklist | null | undefined
): OrderWorklistLine | null {
    return listLinesByStatus(wl, "pending_search")[0] ?? null;
}

export function findLineById(
    wl: OrderWorklist | null | undefined,
    lineId: string
): OrderWorklistLine | null {
    return (wl?.lines ?? []).find((l) => l.id === lineId) ?? null;
}

export function findLineMatchingQuery(
    wl: OrderWorklist | null | undefined,
    query: string
): OrderWorklistLine | null {
    const pending = listLinesByStatus(wl, "pending_search");
    const hit = pending.find((l) => termsReferToSame(l.rawTerm, query));
    if (hit) return hit;
    const searching = listLinesByStatus(wl, "searching");
    return searching.find((l) => termsReferToSame(l.rawTerm, query) || termsReferToSame(l.lastQuery ?? "", query)) ?? null;
}

function touch(wl: OrderWorklist, lines: OrderWorklistLine[], nowIso?: string): OrderWorklist {
    return {
        ...wl,
        lines,
        updatedAtIso: nowIso ?? new Date().toISOString(),
    };
}

export function mapLine(
    wl: OrderWorklist,
    lineId: string,
    fn: (line: OrderWorklistLine) => OrderWorklistLine,
    nowIso?: string
): OrderWorklist {
    const lines = wl.lines.map((l) => (l.id === lineId ? fn(l) : l));
    return touch(wl, lines, nowIso);
}

export function advanceLineAfterSearch(params: {
    worklist: OrderWorklist;
    query: string;
    hitCount: number;
    productKey?: string | null;
    produtoEmbalagemId?: string | null;
    lineId?: string | null;
    nowIso?: string;
}): OrderWorklist {
    const { worklist, query, hitCount } = params;
    const line =
        (params.lineId ? findLineById(worklist, params.lineId) : null) ??
        findLineMatchingQuery(worklist, query);
    if (!line) return worklist;

    const attempts = (line.searchAttempts ?? 0) + 1;
    if (hitCount >= 2) {
        return mapLine(
            worklist,
            line.id,
            (l) => ({
                ...l,
                status: "ambiguous",
                searchAttempts: attempts,
                lastQuery: query,
                productKey: params.productKey ?? l.productKey ?? null,
                pendingPickGroupKey: params.productKey ?? l.pendingPickGroupKey ?? null,
                produtoEmbalagemId: null,
            }),
            params.nowIso
        );
    }
    if (hitCount === 1) {
        const embalagemId = params.produtoEmbalagemId ?? null;
        const hasQty = lHasQty(line);
        /**
         * Qty conhecida: `searching` (ainda bloqueia) até prepare + markLineInDraft.
         * Marcar `in_draft` aqui sem carrinho real = preamble “Já anotei” mentiroso
         * e checkout só com o último SKU (smoke skol+jamel+whisk).
         */
        return mapLine(
            worklist,
            line.id,
            (l) => ({
                ...l,
                status: hasQty ? "searching" : "awaiting_qty",
                searchAttempts: attempts,
                lastQuery: query,
                productKey: params.productKey ?? l.productKey ?? null,
                produtoEmbalagemId: embalagemId,
                pendingPickGroupKey: null,
            }),
            params.nowIso
        );
    }
    // 0 hits
    const status: OrderWorklistLineStatus =
        attempts >= MAX_SEARCH_ATTEMPTS_PER_LINE ? "not_found" : "pending_search";
    return mapLine(
        worklist,
        line.id,
        (l) => ({
            ...l,
            status,
            searchAttempts: attempts,
            lastQuery: query,
        }),
        params.nowIso
    );
}

function lHasQty(line: OrderWorklistLine): boolean {
    return line.quantity != null && Number.isFinite(line.quantity) && line.quantity >= 1;
}

/**
 * Line já está no draft com o mesmo SKU → `in_draft`.
 * Line `in_draft` cujo SKU **não** está no carrinho → `abandoned` (órfão pós-edit/novo pedido).
 * Só reconciliha IDs que batem; não inventa line a partir do draft.
 */
export function reconcileWorklistLinesWithDraft(
    wl: OrderWorklist | null | undefined,
    draft: { items?: Array<{ produtoEmbalagemId?: string | null }> } | null | undefined,
    nowIso?: string
): OrderWorklist {
    const base = wl ?? createEmptyOrderWorklist(nowIso);
    const inCart = new Set(
        (draft?.items ?? [])
            .map((i) => String(i.produtoEmbalagemId ?? "").trim())
            .filter(Boolean)
    );
    let changed = false;
    const lines = base.lines.map((l) => {
        const id = String(l.produtoEmbalagemId ?? "").trim();
        if (l.status === "in_draft") {
            if (!id || !inCart.has(id)) {
                changed = true;
                return {
                    ...l,
                    status: "abandoned" as const,
                    pendingPickGroupKey: null,
                };
            }
            return l;
        }
        if (!id || !inCart.has(id)) return l;
        if (l.status === "abandoned" || l.status === "not_found") {
            return l;
        }
        changed = true;
        return {
            ...l,
            status: "in_draft" as const,
            pendingPickGroupKey: null,
        };
    });
    return changed ? touch(base, lines, nowIso) : base;
}

/** pending_search esgotado sem SKU → not_found (anti-loop force-search). */
export function expireExhaustedPendingSearchLines(
    wl: OrderWorklist | null | undefined,
    nowIso?: string
): OrderWorklist {
    const base = wl ?? createEmptyOrderWorklist(nowIso);
    let changed = false;
    const lines = base.lines.map((l) => {
        if (l.status !== "pending_search") return l;
        if ((l.searchAttempts ?? 0) < MAX_SEARCH_ATTEMPTS_PER_LINE) return l;
        if (String(l.produtoEmbalagemId ?? "").trim()) return l;
        changed = true;
        return { ...l, status: "not_found" as const };
    });
    return changed ? touch(base, lines, nowIso) : base;
}

export function markLineInDraft(params: {
    worklist: OrderWorklist;
    lineId: string;
    produtoEmbalagemId: string;
    quantity?: number | null;
    nowIso?: string;
}): OrderWorklist {
    return mapLine(
        params.worklist,
        params.lineId,
        (l) => ({
            ...l,
            status: "in_draft",
            produtoEmbalagemId: params.produtoEmbalagemId,
            quantity:
                params.quantity != null && params.quantity >= 1
                    ? Math.floor(params.quantity)
                    : l.quantity,
            pendingPickGroupKey: null,
        }),
        params.nowIso
    );
}

export function markLineAwaitingQty(params: {
    worklist: OrderWorklist;
    lineId: string;
    produtoEmbalagemId: string;
    nowIso?: string;
}): OrderWorklist {
    return mapLine(
        params.worklist,
        params.lineId,
        (l) => ({
            ...l,
            status: "awaiting_qty",
            produtoEmbalagemId: params.produtoEmbalagemId,
            pendingPickGroupKey: null,
        }),
        params.nowIso
    );
}

export function applyQuantityToAwaitingLine(params: {
    worklist: OrderWorklist;
    lineId: string;
    quantity: number;
    nowIso?: string;
}): OrderWorklist {
    const qty = Math.floor(params.quantity);
    if (!Number.isFinite(qty) || qty < 1) return params.worklist;
    return mapLine(
        params.worklist,
        params.lineId,
        (l) =>
            l.status === "awaiting_qty"
                ? { ...l, quantity: qty, status: "in_draft" }
                : { ...l, quantity: qty },
        params.nowIso
    );
}

export function abandonWorklist(
    wl: OrderWorklist | null | undefined,
    nowIso?: string
): OrderWorklist {
    const base = wl ?? createEmptyOrderWorklist(nowIso);
    return touch(
        base,
        base.lines.map((l) =>
            BLOCKING_STATUSES.has(l.status) || l.status === "pending_search"
                ? { ...l, status: "abandoned" as const }
                : l
        ),
        nowIso
    );
}

export function clearWorklist(nowIso?: string): OrderWorklist {
    return createEmptyOrderWorklist(nowIso);
}

/** Pending search terms still needing force-search (rawTerm). */
export function pendingSearchTermsFromWorklist(
    wl: OrderWorklist | null | undefined
): string[] {
    return listLinesByStatus(wl, "pending_search").map((l) => l.rawTerm);
}
