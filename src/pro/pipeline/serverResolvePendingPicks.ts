import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, PendingPickGroup, ProSessionState } from "@/src/types/contracts";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/src/pro/tools/prepareOrderDraft";
import { mergePreparedDraftIntoCurrent, unionAllowlistWithDraftIds } from "./mergeOrderDraft";
import {
    buildPickClarificationFreeText,
    groupsPastSafetyNet,
    resolvePendingPickGroupsFromFreeText,
} from "./pendingPickGroups";
import { loadCompanySiglas } from "./customerPackagingHabit";
import { buildClarificationButtons } from "./stages/checkoutPostProcess";

function groupToLegacyPicks(group: PendingPickGroup) {
    return group.options.map((o) => ({
        embalagemId: o.embalagemId,
        label: (o.displayName ?? o.productName ?? "Opção").slice(0, 40),
        price: o.precoVenda,
        productName: o.productName,
    }));
}

export type ServerResolvePendingPicksResult = {
    state: ProSessionState;
    /** Não-vazio ⇒ turno resolvido no servidor (chamador deve encerrar sem chamar a IA). */
    outbound: OutboundMessage[];
    handled: boolean;
    /** C2.4 — grupos que passaram do teto e viraram botão (abandono do free-text). */
    escalatedToButtons: boolean;
};

/**
 * Tenta resolver `pendingPickGroups` (embalagem UN/CX/Fardo ambígua de 1+ produtos citados no
 * mesmo turno) a partir do texto livre do cliente, ANTES de chamar a IA — motor determinístico
 * de `resolvePendingPickGroupsFromFreeText` (mesma lógica de `search_produtos`/sigla comercial).
 *
 * Três desfechos possíveis:
 * - Nenhum grupo pendente: no-op (`handled: false`), pipeline segue normal.
 * - Resolveu tudo: aplica no draft e libera o turno pra IA continuar (endereço/pagamento/etc.),
 *   sem short-circuit — texto de resposta ainda vem do fluxo normal.
 * - Sobrou algo pendente: turno é encerrado aqui (`handled: true`) com uma pergunta consolidada
 *   em texto livre (ou, para grupos que já passaram do teto de tentativas, botão determinístico
 *   de fallback) — nunca chama a IA para essa parte, eliminando o risco de alucinação/duplicidade
 *   com o card de botões (ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md, bug de coerência do S2).
 */
export async function serverResolvePendingPicksFromFreeText(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    userText: string;
}): Promise<ServerResolvePendingPicksResult> {
    const { admin, companyId, customerId, userText } = params;
    const groups = params.state.pendingPickGroups ?? [];
    if (!groups.length) {
        return { state: params.state, outbound: [], handled: false, escalatedToButtons: false };
    }

    let companySiglas: Awaited<ReturnType<typeof loadCompanySiglas>> = [];
    try {
        companySiglas = await loadCompanySiglas(admin, companyId);
    } catch {
        companySiglas = [];
    }

    const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(groups, userText, {
        companySiglas,
    });

    let state = params.state;
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
    }

    if (!remaining.length) {
        return {
            state: { ...state, pendingPickGroups: [], lastSearchPicks: [] },
            outbound: [],
            handled: false,
            escalatedToButtons: false,
        };
    }

    const escalate = groupsPastSafetyNet(remaining);
    const stillFreeText = remaining.filter((g) => !escalate.includes(g));

    const outbound: OutboundMessage[] = [];
    for (const g of escalate) {
        const card = buildClarificationButtons(groupToLegacyPicks(g));
        if (card) outbound.push(card);
    }
    if (stillFreeText.length) {
        outbound.push({
            kind: "text",
            text: buildPickClarificationFreeText(stillFreeText),
        });
    }

    return {
        state: {
            ...state,
            /** Grupos escalados saem do pending (UI de botão usa outbound); free-text permanece. */
            pendingPickGroups: stillFreeText,
            lastSearchPicks: escalate.length
                ? escalate.flatMap((g) => groupToLegacyPicks(g))
                : [],
        },
        outbound,
        handled: true,
        escalatedToButtons: escalate.length > 0,
    };
}
