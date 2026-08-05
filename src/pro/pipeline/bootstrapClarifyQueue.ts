import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { formatSearchPicksClarificationBody } from "./orderDraftPresenter";
import { PICK_EMB_PREFIX } from "./productPickText";

export type BootstrapPendingClarification = NonNullable<
    ProSessionState["bootstrapPendingClarifications"]
>[number];

function buildClarifyOutbound(
    picks: Array<{ embalagemId: string; label: string; price?: number | null }>
): OutboundMessage | null {
    const top = picks.slice(0, 3);
    if (top.length < 2) return null;
    return {
        kind: "buttons",
        text: formatSearchPicksClarificationBody(top),
        buttons: top.map((p, i) => ({
            id: `${PICK_EMB_PREFIX}${p.embalagemId}`,
            title: String(p.label ?? `Opcao ${i + 1}`)
                .replaceAll(/\s+/g, " ")
                .trim()
                .slice(0, 20),
        })),
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
    const clarify = buildClarifyOutbound(picks);
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
