import { tool } from "ai";
import { z } from "zod";
import type { OrderDraftPort } from "@/src/pro/ports/orderDraft.port";
import {
    mergePreparedDraftIntoCurrent,
    unionAllowlistWithDraftIds,
} from "@/src/pro/pipeline/mergeOrderDraft";
import { removePendingPickGroupsByKeys } from "@/src/pro/pipeline/pendingPickGroups";
import type { PrepareOrderDraftCatalogPolicy } from "@/src/pro/tools/prepareOrderDraft";
import type { TurnState } from "./turnState";

const resolvePendingPicksInputSchema = z.object({
    picks: z
        .array(
            z.object({
                product_key: z
                    .string()
                    .describe(
                        "product_key exato de um dos grupos em pending_pick_groups (contexto do turno)."
                    ),
                produto_embalagem_id: z
                    .string()
                    .describe(
                        "Um dos IDs listados nas opções desse product_key — copie literalmente, nunca invente."
                    ),
                quantity: z.number().int().min(1).max(50),
            })
        )
        .describe(
            "Um item por product_key que o cliente esclareceu nesta mensagem (embalagem escolhida + quantidade)."
        ),
});

/**
 * Fallback via IA (schema-enforced) para quando o resolvedor determinístico de texto
 * livre (`resolvePendingPickGroupsFromFreeText`, rodado antes da IA em `runProPipeline`)
 * não conseguiu casar algum grupo pendente com a resposta do cliente. `produto_embalagem_id`
 * é validado contra as opções reais do grupo em `execute` — o modelo nunca escreve um SKU
 * fora do allowlist (mesmo padrão de `prepare_order_draft`/`search_produtos`).
 */
export function createResolvePendingPicksTool(deps: {
    orderDraft: OrderDraftPort;
    companyId: string;
    customerId: string | null;
    turnState: TurnState;
    /** Modo só informações: mantém a tool no ToolSet, mas nunca mexe no rascunho de verdade. */
    disabled?: boolean;
}) {
    return tool({
        description:
            "Aplica a embalagem que o cliente escolheu em texto livre para produto(s) que estavam com mais de uma opção pendente (pending_pick_groups). Use só quando houver grupos pendentes — para cada product_key resolvido nesta mensagem, informe o produto_embalagem_id exato de options e a quantidade.",
        inputSchema: resolvePendingPicksInputSchema,
        execute: async ({ picks }) => {
            if (deps.disabled) {
                return {
                    ok: false,
                    error: "info_only_mode",
                    guidance_for_model_pt: ["Modo só informações: não feche pedido nem monte rascunho."],
                };
            }
            const groups = deps.turnState.pendingPickGroups;
            const validItems: Array<{ produtoEmbalagemId: string; quantity: number }> = [];
            const appliedKeys: string[] = [];
            const rejected: Array<{ product_key: string; reason: string }> = [];

            for (const p of picks ?? []) {
                const key = String(p?.product_key ?? "").trim();
                const embId = String(p?.produto_embalagem_id ?? "").trim();
                const group = groups.find((g) => g.productKey === key);
                if (!group) {
                    rejected.push({ product_key: key, reason: "product_key desconhecido ou já resolvido" });
                    continue;
                }
                const validOption = group.options.some((o) => o.embalagemId === embId);
                if (!validOption) {
                    rejected.push({
                        product_key: key,
                        reason: "produto_embalagem_id não está nas opções deste grupo",
                    });
                    continue;
                }
                const qtyNum = Number(p?.quantity);
                const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.floor(qtyNum) : 1;
                validItems.push({ produtoEmbalagemId: embId, quantity: qty });
                appliedKeys.push(key);
            }

            if (validItems.length) {
                const allowedEmbalagemIds = unionAllowlistWithDraftIds(
                    [...deps.turnState.allowlistIds, ...validItems.map((i) => i.produtoEmbalagemId)],
                    deps.turnState.currentDraft
                );
                const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
                    kind: "search_allowlist",
                    allowedEmbalagemIds,
                };
                const prepared = await deps.orderDraft.prepareFromToolInput({
                    companyId: deps.companyId,
                    customerId: deps.customerId,
                    body: { items: validItems, address: null },
                    catalogPolicy,
                });
                deps.turnState.currentDraft = mergePreparedDraftIntoCurrent(
                    deps.turnState.currentDraft,
                    prepared.draft
                );
                deps.turnState.prepareInvokedThisTurn = true;
                deps.turnState.lastPrepareOutcome = { ok: prepared.ok, errors: [...prepared.errors] };
            }

            deps.turnState.pendingPickGroups = removePendingPickGroupsByKeys(
                deps.turnState.pendingPickGroups,
                appliedKeys
            );

            const stillPending = deps.turnState.pendingPickGroups;
            return {
                ok: rejected.length === 0,
                applied_product_keys: appliedKeys,
                rejected,
                still_pending_product_keys: stillPending.map((g) => g.productKey),
                guidance_for_model_pt:
                    stillPending.length > 0
                        ? [
                              `Ainda falta esclarecer: ${stillPending
                                  .map((g) => g.productLabel)
                                  .join(", ")}. Pergunte de novo em texto livre (sem listar preço/opções) antes de fechar.`,
                          ]
                        : ["Todos os itens ambíguos foram resolvidos. Pode seguir o fluxo normal."],
            };
        },
    });
}
