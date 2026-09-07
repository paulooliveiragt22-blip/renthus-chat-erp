import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import { toChatCatalogPublicItem } from "@/src/pro/tools/catalogPublicDto";
import {
    disambiguatePackagingForSearchRows,
    isSamePackagingFamily,
} from "@/src/pro/pipeline/packagingDisambiguation";
import { loadCompanySiglas, loadCustomerSiglaHabits } from "@/src/pro/pipeline/customerPackagingHabit";
import {
    buildPendingPickGroup,
    productKeyFromQuery,
    type PendingPickGroup,
} from "@/src/pro/pipeline/pendingPickGroups";
import {
    extractQuantityNearQuery,
    hasExplicitOrderQuantityInText,
} from "@/src/pro/tools/parseQtyPt";
import {
    explicitCommercialSiglaNearQuery,
    preferRowsMatchingTagAliases,
    queryAliasTokens,
    type TagAliasRow,
} from "@/src/pro/tools/tagAliasMatch";
import { loadEmbalagensByVolumeIds, type ChatProdutoRow } from "@/src/pro/tools/searchProdutos";

/**
 * Tag bateu numa sigla e o cliente pediu outra (ex.: buchudinha só na UN + "caixa"):
 * carrega irmãos do mesmo `product_volume_id` para o promote UN↔CX.
 */
async function expandPoolWithTagVolumeSiblings(
    deps: SearchProdutosForAiDeps,
    rows: ChatProdutoRow[],
    query: string
): Promise<ChatProdutoRow[]> {
    const wantSigla = explicitCommercialSiglaNearQuery(query, deps.userText);
    if (!wantSigla || !rows.length) return rows;

    const tokens = queryAliasTokens(`${query} ${deps.userText}`);
    if (!tokens.length) return rows;

    const tagHits = rows.filter((row) => {
        const tags = normalizeTagsHay(row.tags);
        if (!tags) return false;
        return tokens.some((t) => tags.includes(t));
    });
    if (!tagHits.length) return rows;

    const alreadyHasWanted = tagHits.some(
        (r) => String(r.sigla_comercial ?? "").trim().toUpperCase() === wantSigla
    );
    if (alreadyHasWanted) return rows;

    const volumeIds = [
        ...new Set(
            tagHits
                .map((r) => String(r.product_volume_id ?? "").trim())
                .filter(Boolean)
        ),
    ];
    if (!volumeIds.length) return rows;

    try {
        const siblings = await loadEmbalagensByVolumeIds(
            deps.admin,
            deps.companyId,
            volumeIds
        );
        if (!siblings.length) return rows;
        const byId = new Map(rows.map((r) => [String(r.id), r]));
        for (const s of siblings) byId.set(String(s.id), s);
        return [...byId.values()];
    } catch (err: unknown) {
        console.warn(
            "[searchProdutosForAi] expand tag volume siblings failed",
            err instanceof Error ? err.message : err
        );
        return rows;
    }
}

function normalizeTagsHay(tags?: string | null): string {
    return String(tags ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}
/**
 * Orquestração de `search_produtos` extraída de `ai.service.full.ts` (agora reusável por
 * qualquer implementação de `AiService`, incl. o loop Vercel AI SDK da Fase 3 — ver
 * docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md). Comportamento idêntico ao método privado anterior:
 * busca no catálogo, desambiguação de embalagem (UN/CX) e guidance textual pro modelo.
 * Sem mutação por referência — quem chama decide o que fazer com o allowlist/picks devolvidos.
 */

export type SearchProdutosForAiInput = {
    query: string;
    categoryHint?: string | null;
};

export type SearchProdutosForAiDeps = {
    admin: SupabaseClient;
    catalog: CatalogPort;
    companyId: string;
    /** Para aprender hábito de sigla (UN/CX) do cliente por produto. */
    customerId: string | null;
    /** Texto do turno atual — usado para desambiguar embalagem por menção explícita/quantidade. */
    userText: string;
    /** ADR 0011 — amarra PendingPickGroup à line da worklist. */
    worklistLineId?: string | null;
};

export type SearchProdutosPickSummary = {
    embalagemId: string;
    label: string;
    price: number | null;
    productName: string | null;
};

export type SearchProdutosForAiResult = {
    /** Corpo pronto para `JSON.stringify` como conteúdo do tool_result (sem tool_use_id). */
    body: Record<string, unknown>;
    /** IDs de produto_embalagem retornados nesta busca — allowlist da próxima prepare_order_draft. */
    allowlistIds: string[];
    lastSearchPicks: SearchProdutosPickSummary[];
    /** Busca não encontrou nada — quem chama decide se incrementa/zera o streak de vazio. */
    wasEmpty: boolean;
    /**
     * Presente quando a busca ainda ficou com 2+ resultados após a tentativa de
     * desambiguação por texto do turno atual — seja ambiguidade de embalagem do mesmo
     * produto (UN/CX/Fardo) ou de produtos/variantes com nomes distintos batendo no mesmo
     * termo (ex.: "original" → "ORIGINAL 600ML" e "ORIGINAL LATA"). Chamador faz upsert em
     * `TurnState.pendingPickGroups` (ver `pendingPickGroups.ts`) — resolvido em texto livre,
     * sem o teto de 3 opções dos botões do WhatsApp.
     */
    pendingPickGroup: PendingPickGroup | null;
};

async function resolvePackagingHabitForRows(
    deps: SearchProdutosForAiDeps,
    rows: Array<{ produto_id?: string | null }>
): Promise<string | null> {
    const produtoId = rows.find((r) => r.produto_id)?.produto_id?.trim();
    if (!deps.customerId || !produtoId) return null;
    const habits = await loadCustomerSiglaHabits({
        admin: deps.admin,
        companyId: deps.companyId,
        customerId: deps.customerId,
        productIds: [produtoId],
    });
    return habits.get(produtoId) ?? null;
}

export async function runSearchProdutosForAi(
    input: SearchProdutosForAiInput,
    deps: SearchProdutosForAiDeps
): Promise<SearchProdutosForAiResult> {
    const query = input.query;
    const categoryHint = input.categoryHint ?? null;
    const detailed = await deps.catalog.searchDetailed(deps.companyId, query, { categoryHint, limit: 8 });

    const pool = await expandPoolWithTagVolumeSiblings(
        deps,
        detailed.items as ChatProdutoRow[],
        query
    );
    let rows = preferRowsMatchingTagAliases(pool as TagAliasRow[], query, deps.userText) as ChatProdutoRow[];
    if (rows.length >= 2) {
        let companySiglas: Awaited<ReturnType<typeof loadCompanySiglas>> = [];
        let habitSigla: string | null = null;
        try {
            [companySiglas, habitSigla] = await Promise.all([
                loadCompanySiglas(deps.admin, deps.companyId),
                resolvePackagingHabitForRows(deps, rows),
            ]);
        } catch (err: unknown) {
            console.warn(
                "[searchProdutosForAi] sigla/habit load failed",
                err instanceof Error ? err.message : err
            );
        }
        rows = disambiguatePackagingForSearchRows(rows, query, deps.userText, {
            companySiglas,
            habitSigla,
        });
    }

    const publicItems = rows.map((r) => toChatCatalogPublicItem(r as unknown as Record<string, unknown>));
    const allowlistIds = publicItems.map((r) => r.id).filter(Boolean);
    const lastSearchPicks: SearchProdutosPickSummary[] = publicItems.slice(0, 3).map((r) => ({
        embalagemId: r.id,
        label: String(r.display_name || r.product_name || "Item").slice(0, 40),
        price: r.preco_venda,
        productName: r.product_name,
    }));

    const guidanceForModelPt =
        publicItems.length > 0
            ? [
                  "Use apenas o UUID de cada linha em items (campos id ou produto_embalagem_id) em prepare_order_draft — não invente UUID.",
                  `IDs exatos desta busca (copie um literalmente): ${allowlistIds.join(", ")}.`,
                  "Não cite custo, estoque numérico, código interno, EAN nem UUID no texto ao cliente.",
                  "descricao_ingredientes = o que acompanha; informacoes = como é feito / extras.",
                  ...(detailed.didYouMean.length
                      ? [
                            `did_you_mean: ${detailed.didYouMean.map((d) => d.label).join(" | ")}. Ofereça essas opções se o cliente digitou errado.`,
                        ]
                      : []),
                  ...(publicItems.length >= 2
                      ? [
                            "Há mais de uma opção: NÃO liste preços/opções no texto — o servidor já envia a pergunta de esclarecimento ao cliente.",
                        ]
                      : hasExplicitOrderQuantityInText(deps.userText)
                        ? [
                              "Uma opção clara e o cliente JÁ disse a quantidade: chame prepare_order_draft com este UUID e essa quantidade. NÃO pergunte quantas unidades de novo.",
                          ]
                        : [
                              "Uma opção clara: informe nome + preço de venda e pergunte a quantidade. Se o cliente responder só com número (ex.: 3), o servidor pode montar o rascunho — chame prepare_order_draft se ainda não houver itens.",
                          ]),
              ]
            : [
                  "Nenhum item no catálogo para este termo (busca fuzzy também vazia).",
                  "Não invente nome nem preço. Peça outro termo mais curto ou categoria; opcionalmente oriente o cardápio web.",
              ];

    const sameFamily = isSamePackagingFamily(rows);
    const requestedQuantity = extractQuantityNearQuery(query, deps.userText);
    const pendingPickGroup =
        rows.length >= 2
            ? buildPendingPickGroup(
                  productKeyFromQuery(query),
                  sameFamily
                      ? String(rows[0]?.product_name ?? query).trim() || query
                      : query.trim() || String(rows[0]?.product_name ?? "Item"),
                  rows as unknown as Array<{
                      id: string;
                      display_name?: string | null;
                      product_name?: string | null;
                      sigla_comercial?: string | null;
                      preco_venda?: number | string | null;
                      fator_conversao?: number | string | null;
                      product_volume_id?: string | null;
                      produto_id?: string | null;
                  }>,
                  {
                      requestedQuantity,
                      lineId: deps.worklistLineId ?? `search_${productKeyFromQuery(query)}`,
                  }
              )
            : null;

    return {
        body: {
            items: publicItems,
            did_you_mean: detailed.didYouMean,
            query_normalized: detailed.queryNormalized,
            produto_embalagem_ids_validos: allowlistIds,
            guidance_for_model_pt: guidanceForModelPt,
        },
        allowlistIds,
        lastSearchPicks,
        wasEmpty: detailed.empty,
        pendingPickGroup,
    };
}
