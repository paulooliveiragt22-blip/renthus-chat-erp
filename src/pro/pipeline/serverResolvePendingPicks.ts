import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, PendingPickGroup, ProSessionState } from "@/src/types/contracts";
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
    createEmptyOrderWorklist,
    markLineInDraft,
    pendingSearchTermsFromWorklist,
    worklistBlocksCheckout,
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
}): Promise<ServerResolvePendingPicksResult> {
    const { admin, companyId, customerId, userText } = params;
    const groups = ensureGroupLineIds(params.state.pendingPickGroups ?? []);
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

    if (!remaining.length) {
        if (!resolved.length) {
            return {
                state: {
                    ...state,
                    pendingPickGroups: [],
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
        const nextState: ProSessionState = {
            ...state,
            pendingPickGroups: [],
            lastSearchPicks: [],
            orderWorklist,
            pendingOrderMentions: [],
        };
        /** Embalagens resolvidas, mas ainda há linhas a buscar/qty — não checkout. */
        if (worklistBlocksCheckout(orderWorklist)) {
            const pendingTerms = pendingSearchTermsFromWorklist(orderWorklist);
            const stillMsg =
                pendingTerms.length > 0
                    ? `Ainda vou localizar: ${pendingTerms.join(", ")}.`
                    : "Ainda tenho itens do seu pedido para localizar.";
            const outbound: OutboundMessage[] = [];
            if (ackText) outbound.push({ kind: "text", text: ackText });
            outbound.push({ kind: "text", text: stillMsg });
            return {
                state: nextState,
                outbound,
                handled: false,
                escalatedToButtons: false,
                continueToCheckoutWithoutAi: false,
            };
        }
        /** Tudo resolvido na worklist: ack canônico + checkout sem IA. */
        return {
            state: nextState,
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
            pendingPickGroups: remaining,
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
