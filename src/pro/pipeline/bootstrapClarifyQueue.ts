import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { formatSearchPicksClarificationBody } from "./orderDraftPresenter";
import { PICK_EMB_PREFIX } from "./productPickText";
import { buildUniquePickButtons } from "./pickButtonTitles";
import { catalogProductHintFromPicks } from "./catalogProductHint";

export type BootstrapPendingClarification = NonNullable<
    ProSessionState["bootstrapPendingClarifications"]
>[number];

function buildClarifyOutbound(
    picks: Array<{
        embalagemId: string;
        label: string;
        price?: number | null;
        productName?: string | null;
    }>,
    opts?: { habitConflict?: boolean; habit?: "UN" | "CX" | null }
): OutboundMessage | null {
    const top = picks.slice(0, 3);
    if (top.length < 2) return null;
    const productHint = catalogProductHintFromPicks(top);
    return {
        kind: "buttons",
        text: formatSearchPicksClarificationBody(top, {
            productHint,
            habitConflict: opts?.habitConflict,
            habit: opts?.habit,
        }),
        buttons: buildUniquePickButtons(top, PICK_EMB_PREFIX),
    };
}

/**
 * Consome a próxima clarificação da fila do bootstrap e atualiza lastSearchPicks.
 */
export function dequeueBootstrapClarification(state: ProSessionState): {
    state: ProSessionState;
    outbound: OutboundMessage[];
} {
    const queue = [...(state.bootstrapPendingClarifications ?? [])];
    if (!queue.length) {
        return { state, outbound: [] };
    }
    const next = queue.shift()!;
    const picks = (next.picks ?? []).slice(0, 3);
    const clarify = buildClarifyOutbound(picks, {
        habitConflict: next.habitConflict === true,
        habit: next.habit ?? null,
    });
    if (!clarify) {
        return dequeueBootstrapClarification({
            ...state,
            bootstrapPendingClarifications: queue,
        });
    }
    return {
        state: {
            ...state,
            bootstrapPendingClarifications: queue,
            lastSearchPicks: picks,
            pendingClarifyQuantity:
                Number.isFinite(Number(next.quantity)) && Number(next.quantity) > 0
                    ? Number(next.quantity)
                    : 1,
            pendingClarifySegment: String(next.segment ?? "").trim() || null,
            searchProdutoEmbalagemIds: [
                ...picks.map((p) => p.embalagemId),
                ...(state.searchProdutoEmbalagemIds ?? []),
                ...(state.bootstrapResolvedEmbalagemIds ?? []),
            ],
        },
        outbound: [clarify],
    };
}

export function hasPendingBootstrapClarifications(state: ProSessionState): boolean {
    return (state.bootstrapPendingClarifications?.length ?? 0) > 0;
}
