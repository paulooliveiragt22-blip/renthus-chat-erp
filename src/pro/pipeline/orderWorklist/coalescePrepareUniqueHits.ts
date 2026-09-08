import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, OrderWorklist } from "@/src/types/contracts";
import {
    mapLine,
    markLineInDraft,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import { mergePreparedDraftIntoCurrent, unionAllowlistIds } from "@/src/pro/pipeline/mergeOrderDraft";
import { prepareOrderDraftFromTool } from "@/src/pro/tools/prepareOrderDraft";
import { parseOutOfStockNamesFromPrepareErrors } from "@/src/pro/pipeline/outOfStockOffer";

export type UniquePrepareHit = {
    lineId: string;
    produtoEmbalagemId: string;
    quantity: number;
};

/**
 * Um único `prepare_order_draft` com N hits unívocos (ADR 0011 D7 coalesce).
 *
 * Aceita **draft parcial** (itens ok sem endereço/pagamento): `prep.ok` exige
 * fullOk; o path de pick (`serverResolve`) já mergeia `prep.draft` parcial.
 * Exigir `prep.ok` aqui revertia unique hits → `pending_search`, queimava
 * `searchAttempts` e mandava jamel/UN-only para `not_found` + cardápio (smoke Ferrester).
 *
 * Falha real (sem itens no draft) → lines voltam a `pending_search` e
 * **descontam** 1 attempt (busca tinha achado o SKU; prepare que falhou).
 */
export async function coalescePrepareUniqueHits(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    worklist: OrderWorklist;
    allowlistIds: string[];
    draft: OrderDraft | null;
    hits: readonly UniquePrepareHit[];
}): Promise<{
    worklist: OrderWorklist;
    allowlistIds: string[];
    draft: OrderDraft | null;
    preparedLineIds: string[];
    prepareCallCount: number;
    outOfStockNames: string[];
}> {
    const emptyOos: string[] = [];
    const hits = params.hits.filter(
        (h) =>
            h.lineId &&
            h.produtoEmbalagemId &&
            Number.isFinite(h.quantity) &&
            h.quantity >= 1
    );
    if (!hits.length) {
        return {
            worklist: params.worklist,
            allowlistIds: params.allowlistIds,
            draft: params.draft,
            preparedLineIds: [],
            prepareCallCount: 0,
            outOfStockNames: emptyOos,
        };
    }

    const allowlistIds = unionAllowlistIds(
        params.allowlistIds,
        hits.map((h) => h.produtoEmbalagemId)
    );

    const revertHitsToPendingSearch = (worklist: OrderWorklist): OrderWorklist => {
        let next = worklist;
        for (const h of hits) {
            next = mapLine(next, h.lineId, (l) => ({
                ...l,
                status: "pending_search" as const,
                produtoEmbalagemId: null,
                /** Busca já tinha hit; não contar prepare-fail como miss de catálogo. */
                searchAttempts: Math.max(0, (l.searchAttempts ?? 1) - 1),
            }));
        }
        return next;
    };

    try {
        const prep = await prepareOrderDraftFromTool(
            params.admin,
            params.companyId,
            params.customerId,
            {
                items: hits.map((h) => ({
                    produtoEmbalagemId: h.produtoEmbalagemId,
                    quantity: h.quantity,
                })),
                address: null,
            },
            {
                kind: "search_allowlist",
                allowedEmbalagemIds: allowlistIds,
            }
        );

        const partialItems = prep.draft?.items?.length ?? 0;
        if (partialItems < 1) {
            return {
                worklist: revertHitsToPendingSearch(params.worklist),
                allowlistIds,
                draft: params.draft,
                preparedLineIds: [],
                prepareCallCount: 1,
                outOfStockNames: parseOutOfStockNamesFromPrepareErrors(prep.errors),
            };
        }

        const draft = mergePreparedDraftIntoCurrent(params.draft, prep.draft);
        let worklist = params.worklist;
        const preparedLineIds: string[] = [];
        for (const h of hits) {
            const inDraft = (draft?.items ?? []).some(
                (it) => String(it.produtoEmbalagemId) === String(h.produtoEmbalagemId)
            );
            if (!inDraft) continue;
            worklist = markLineInDraft({
                worklist,
                lineId: h.lineId,
                produtoEmbalagemId: h.produtoEmbalagemId,
                quantity: h.quantity,
            });
            preparedLineIds.push(h.lineId);
        }
        if (!preparedLineIds.length) {
            return {
                worklist: revertHitsToPendingSearch(params.worklist),
                allowlistIds,
                draft: params.draft,
                preparedLineIds: [],
                prepareCallCount: 1,
                outOfStockNames: parseOutOfStockNamesFromPrepareErrors(prep.errors),
            };
        }
        return {
            worklist,
            allowlistIds,
            draft,
            preparedLineIds,
            prepareCallCount: 1,
            outOfStockNames: parseOutOfStockNamesFromPrepareErrors(prep.errors),
        };
    } catch {
        return {
            worklist: revertHitsToPendingSearch(params.worklist),
            allowlistIds,
            draft: params.draft,
            preparedLineIds: [],
            prepareCallCount: 1,
            outOfStockNames: emptyOos,
        };
    }
}
