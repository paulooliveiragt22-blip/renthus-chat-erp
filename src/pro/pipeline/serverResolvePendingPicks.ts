import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, OrderWorklist, PendingPickGroup, ProSessionState } from "@/src/types/contracts";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/src/pro/tools/prepareOrderDraft";
import { mergePreparedDraftIntoCurrent, unionAllowlistWithDraftIds } from "./mergeOrderDraft";
import {
    buildPickClarificationFreeText,
    buildResolvedPendingPicksAck,
    groupsPastSafetyNet,
    labelForUnknownPackagingSigla,
    resolvePendingPickGroupsFromFreeText,
} from "./pendingPickGroups";
import { loadCompanySiglas } from "./customerPackagingHabit";
import { buildClarificationButtons } from "./stages/checkoutPostProcess";
import {
    activeClarifyPickGroups,
    groupsAfterActiveResolve,
    pendingPickGroupsAlignedWithWorklist,
} from "./orderWorklist/syncPendingPickGroupsFromWorklist";
import { searchPendingWorklistLinesParallel } from "./orderWorklist/searchPendingWorklistLinesParallel";
import { SupabaseCatalogAdapter } from "@/src/pro/adapters/supabase/catalog.supabase";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import {
    createEmptyOrderWorklist,
    listLinesByStatus,
    markLineInDraft,
    pendingSearchTermsFromWorklist,
    worklistPreventsCheckout,
} from "@/src/pro/domain/orderWorklist/orderWorklist";

function groupToLegacyPicks(group: PendingPickGroup) {
    return group.options.map((o) => ({
        embalagemId: o.embalagemId,
        label: (o.displayName ?? o.productName ?? "Opção").slice(0, 40),
        price: o.precoVenda,
        productName: o.productName,
    }));
}

function availablePackagingLabels(groups: readonly PendingPickGroup[]): string {
    const siglas = new Set<string>();
    for (const g of groups) {
        for (const o of g.options) {
            const s = String(o.siglaComercial ?? "")
                .trim()
                .toUpperCase();
            if (s) siglas.add(s);
        }
    }
    const order = ["UN", "CX", "FARD", "PAC", "COMBO"];
    const sorted = [...siglas].sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return sorted
        .map((s) => {
            if (s === "UN") return "unidade";
            if (s === "CX") return "caixa";
            if (s === "FARD") return "fardo";
            if (s === "PAC") return "pacote";
            return s;
        })
        .join(", ");
}

/** ADR 0011 — todo PendingPickGroup precisa de lineId antes do resolve. */
function ensureGroupLineIds(groups: readonly PendingPickGroup[]): PendingPickGroup[] {
    return groups.map((g, i) =>
        g.lineId
            ? g
            : {
                  ...g,
                  lineId: `legacy_pick_${i}_${g.productKey}`,
              }
    );
}

function applyResolvedToWorklist(params: {
    worklist: NonNullable<ProSessionState["orderWorklist"]>;
    groups: readonly PendingPickGroup[];
    resolved: readonly { productKey: string; embalagemId: string; quantity: number }[];
}): NonNullable<ProSessionState["orderWorklist"]> {
    let wl = params.worklist;
    for (const r of params.resolved) {
        const group = params.groups.find((g) => g.productKey === r.productKey);
        const lineId = group?.lineId;
        if (!lineId) continue;
        // Free-text resolve + prepare sempre têm quantity ≥ 1 → in_draft.
        // (awaiting_qty: resolve_pending_picks tool quando qty vem null.)
        wl = markLineInDraft({
            worklist: wl,
            lineId,
            produtoEmbalagemId: r.embalagemId,
            quantity: r.quantity,
        });
    }
    return wl;
}

/** Follow-up determinístico quando picks fecharam mas a worklist ainda bloqueia. */
export function buildWorklistBlockingFollowUp(
    worklist: OrderWorklist | null | undefined
): string {
    const awaiting = listLinesByStatus(worklist, "awaiting_qty");
    if (awaiting.length) {
        const names = awaiting.map((l) => l.rawTerm).join(", ");
        return awaiting.length === 1
            ? `Quantas unidades de ${names} você quer?`
            : `Quantas unidades você quer destes itens: ${names}?`;
    }
    const pending = pendingSearchTermsFromWorklist(worklist);
    const searching = listLinesByStatus(worklist, "searching");
    const openSearch = [
        ...pending,
        ...searching.map((l) => l.rawTerm).filter((t) => !pending.includes(t)),
    ];
    if (openSearch.length) {
        return `Ainda vou localizar: ${openSearch.join(", ")}.`;
    }
    const ambiguous = listLinesByStatus(worklist, "ambiguous");
    if (ambiguous.length) {
        return `Ainda preciso da sua escolha para: ${ambiguous.map((l) => l.rawTerm).join(", ")}.`;
    }
    const orphans = listLinesByStatus(worklist, "in_draft");
    if (orphans.length) {
        return `Ainda estou confirmando no pedido: ${orphans.map((l) => l.rawTerm).join(", ")}.`;
    }
    return "Ainda tenho itens do seu pedido para fechar.";
}

/**
 * Prefácio quando há irmãos na worklist além da ambiguidade atual
 * (evita parecer que só o whisky existe no pedido).
 * Só menciona `in_draft` se o SKU estiver de fato no draft (sem mentir “Já anotei”).
 */
export function buildWorklistSiblingProgressPreamble(
    worklist: OrderWorklist | null | undefined,
    draft?: { items?: Array<{ produtoEmbalagemId?: string | null }> } | null
): string {
    const parts: string[] = [];
    const inCart = new Set(
        (draft?.items ?? [])
            .map((i) => String(i.produtoEmbalagemId ?? "").trim())
            .filter(Boolean)
    );
    const inDraft = listLinesByStatus(worklist, "in_draft").filter((l) => {
        const id = String(l.produtoEmbalagemId ?? "").trim();
        return id ? inCart.has(id) : false;
    });
    if (inDraft.length) {
        parts.push(
            `Já anotei: ${inDraft
                .map((l) => (l.quantity != null ? `${l.quantity}× ${l.rawTerm}` : l.rawTerm))
                .join("; ")}.`
        );
    }
    const awaiting = listLinesByStatus(worklist, "awaiting_qty");
    if (awaiting.length) {
        parts.push(`Falta quantidade de: ${awaiting.map((l) => l.rawTerm).join(", ")}.`);
    }
    const pending = pendingSearchTermsFromWorklist(worklist);
    const searching = listLinesByStatus(worklist, "searching");
    const stillOpen = [
        ...pending,
        ...searching.map((l) => l.rawTerm).filter((t) => !pending.includes(t)),
    ];
    if (stillOpen.length) {
        parts.push(`Ainda vou buscar: ${stillOpen.join(", ")}.`);
    }
    /** D8: demais ambiguous (depois do ativo) — não listar opções, só avisar. */
    const ambiguous = listLinesByStatus(worklist, "ambiguous");
    if (ambiguous.length > 1) {
        const later = ambiguous.slice(1).map((l) => l.rawTerm);
        parts.push(`Depois confirmo: ${later.join(", ")}.`);
    }
    return parts.join(" ");
}

export type ServerResolvePendingPicksResult = {
    state: ProSessionState;
    outbound: OutboundMessage[];
    handled: boolean;
    escalatedToButtons: boolean;
    /**
     * Resolveu todos os pendingPickGroups via free-text **e** a worklist não
     * bloqueia (sem pending_search/ambiguous/awaiting_qty). Pipeline vai ao
     * checkoutPostProcess sem IA. Se a worklist ainda bloqueia, fica false —
     * a IA deve force-search os irmãos (ADR 0011).
     */
    continueToCheckoutWithoutAi: boolean;
};

/**
 * Tenta resolver `pendingPickGroups` a partir do texto livre do cliente, ANTES da IA.
 */
export async function serverResolvePendingPicksFromFreeText(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    userText: string;
    /** Injeta catálogo (testes); default = SupabaseCatalogAdapter. */
    catalog?: CatalogPort;
}): Promise<ServerResolvePendingPicksResult> {
    const { admin, companyId, customerId, userText } = params;
    const catalog = params.catalog ?? new SupabaseCatalogAdapter(admin);
    const ensured = ensureGroupLineIds(params.state.pendingPickGroups ?? []);
    /** D8: resolve free-text só contra o group ativo (índices da mensagem). */
    const groups = activeClarifyPickGroups(params.state.orderWorklist, ensured);
    if (!groups.length) {
        return {
            state: params.state,
            outbound: [],
            handled: false,
            escalatedToButtons: false,
            continueToCheckoutWithoutAi: false,
        };
    }

    let companySiglas: Awaited<ReturnType<typeof loadCompanySiglas>> = [];
    try {
        companySiglas = await loadCompanySiglas(admin, companyId);
    } catch {
        companySiglas = [];
    }

    const { resolved, remaining, unknownPackagingSigla } = resolvePendingPickGroupsFromFreeText(
        groups,
        userText,
        { companySiglas }
    );

    let state = params.state;
    let orderWorklist = state.orderWorklist ?? createEmptyOrderWorklist();

    if (resolved.length) {
        const allowedEmbalagemIds = unionAllowlistWithDraftIds(
            [...(state.searchProdutoEmbalagemIds ?? []), ...resolved.map((r) => r.embalagemId)],
            state.draft
        );
        const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
            kind: "search_allowlist",
            allowedEmbalagemIds,
        };
        const prepared = await prepareOrderDraftFromTool(
            admin,
            companyId,
            customerId,
            {
                items: resolved.map((r) => ({
                    produtoEmbalagemId: r.embalagemId,
                    quantity: r.quantity,
                })),
                address: null,
            },
            catalogPolicy
        );
        state = { ...state, draft: mergePreparedDraftIntoCurrent(state.draft, prepared.draft) };
        orderWorklist = applyResolvedToWorklist({
            worklist: orderWorklist,
            groups,
            resolved,
        });
    }

    const ackText = buildResolvedPendingPicksAck(resolved, groups);

    const syncedGroups = groupsAfterActiveResolve({
        worklist: orderWorklist,
        allGroups: ensured,
        activeGroups: groups,
        remaining,
    });

    if (!remaining.length) {
        if (!resolved.length) {
            return {
                state: {
                    ...state,
                    pendingPickGroups: syncedGroups,
                    lastSearchPicks: [],
                    orderWorklist,
                    pendingOrderMentions: [],
                },
                outbound: [],
                handled: false,
                escalatedToButtons: false,
                continueToCheckoutWithoutAi: false,
            };
        }
        let nextState: ProSessionState = {
            ...state,
            pendingPickGroups: syncedGroups,
            lastSearchPicks: [],
            orderWorklist,
            pendingOrderMentions: [],
        };
        /**
         * Embalagens resolvidas, mas ainda há linhas a buscar/qty — não checkout.
         * ADR 0011 D5: batch server dos irmãos `pending_search` (query=`rawTerm`).
         * D8: clarify outbound = 1 ativo (irmãos ficam no estado).
         */
        if (worklistPreventsCheckout(orderWorklist, nextState.draft)) {
            const afterBatch = await searchPendingWorklistLinesParallel({
                admin,
                catalog,
                companyId,
                customerId,
                state: nextState,
                packagingContextText: "",
            });
            nextState = {
                ...afterBatch.state,
                pendingPickGroups: pendingPickGroupsAlignedWithWorklist(
                    afterBatch.state.orderWorklist ?? orderWorklist,
                    afterBatch.state.pendingPickGroups ?? syncedGroups
                ),
                lastSearchPicks: [],
                pendingOrderMentions: [],
            };
        }

        const batchWl = nextState.orderWorklist ?? orderWorklist;
        const stored = pendingPickGroupsAlignedWithWorklist(
            batchWl,
            nextState.pendingPickGroups ?? []
        );
        const active = activeClarifyPickGroups(batchWl, stored);

        if (active.length) {
            const outbound: OutboundMessage[] = [];
            if (ackText) outbound.push({ kind: "text", text: ackText });
            const preamble = buildWorklistSiblingProgressPreamble(batchWl, nextState.draft);
            if (preamble) outbound.push({ kind: "text", text: preamble });
            outbound.push({
                kind: "text",
                text: buildPickClarificationFreeText(active),
            });
            return {
                state: {
                    ...nextState,
                    pendingPickGroups: stored,
                },
                outbound,
                handled: true,
                escalatedToButtons: false,
                continueToCheckoutWithoutAi: false,
            };
        }

        if (worklistPreventsCheckout(batchWl, nextState.draft)) {
            const outbound: OutboundMessage[] = [];
            if (ackText) outbound.push({ kind: "text", text: ackText });
            outbound.push({
                kind: "text",
                text: buildWorklistBlockingFollowUp(batchWl),
            });
            return {
                state: {
                    ...nextState,
                    pendingPickGroups: stored,
                },
                outbound,
                handled: true,
                escalatedToButtons: false,
                continueToCheckoutWithoutAi: false,
            };
        }

        /** Tudo resolvido na worklist: ack canônico + checkout sem IA. */
        return {
            state: {
                ...nextState,
                pendingPickGroups: stored,
            },
            outbound: ackText ? [{ kind: "text", text: ackText }] : [],
            handled: false,
            escalatedToButtons: false,
            continueToCheckoutWithoutAi: true,
        };
    }

    const escalate = groupsPastSafetyNet(remaining);
    const stillFreeText = remaining.filter((g) => !escalate.includes(g));

    const outbound: OutboundMessage[] = [];
    if (ackText) {
        outbound.push({ kind: "text", text: ackText });
    }
    if (unknownPackagingSigla) {
        const packLabel = labelForUnknownPackagingSigla(unknownPackagingSigla);
        const avail = availablePackagingLabels(remaining);
        outbound.push({
            kind: "text",
            text: avail
                ? `Não trabalhamos com ${packLabel} nesses itens. Opções: ${avail}.`
                : `Não trabalhamos com ${packLabel} nesses itens. Escolha uma das opções abaixo.`,
        });
    }
    for (const g of escalate) {
        const card = buildClarificationButtons(groupToLegacyPicks(g));
        if (card) outbound.push(card);
        else {
            outbound.push({
                kind: "text",
                text: buildPickClarificationFreeText([g]),
            });
        }
    }
    if (stillFreeText.length) {
        outbound.push({
            kind: "text",
            text: buildPickClarificationFreeText(stillFreeText),
        });
    } else if (!escalate.length && remaining.length) {
        outbound.push({
            kind: "text",
            text: buildPickClarificationFreeText(remaining),
        });
    }

    if (!outbound.length && remaining.length) {
        outbound.push({
            kind: "text",
            text: buildPickClarificationFreeText(remaining),
        });
    }

    return {
        state: {
            ...state,
            pendingPickGroups: syncedGroups,
            lastSearchPicks: escalate.length ? escalate.flatMap((g) => groupToLegacyPicks(g)) : [],
            orderWorklist,
            pendingOrderMentions: [],
        },
        outbound,
        handled: true,
        escalatedToButtons: escalate.length > 0,
        continueToCheckoutWithoutAi: false,
    };
}
