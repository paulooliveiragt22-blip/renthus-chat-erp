import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import { toChatCatalogPublicItem } from "@/src/pro/tools/catalogPublicDto";
import {
    disambiguatePackagingForSearchRows,
    isSamePackagingFamily,
} from "@/src/pro/pipeline/packagingDisambiguation";
import {
    loadCompanySiglas,
    loadCustomerSiglaHabits,
    type CompanySigla,
} from "@/src/pro/pipeline/customerPackagingHabit";
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
import type { BatchSearchContext } from "@/src/pro/pipeline/orderWorklist/batchSearchContext";
import { habitSiglaForProductIds } from "@/src/pro/pipeline/orderWorklist/batchSearchContext";

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

export type SearchProdutosForAiInput = {
    query: string;
    categoryHint?: string | null;
};

export type SearchProdutosForAiDeps = {
    admin: SupabaseClient;
    catalog: CatalogPort;
    companyId: string;
    customerId: string | null;
    userText: string;
    worklistLineId?: string | null;
    worklistLineQuantity?: number | null;
    /** Batch paralelo (ADR 0011 D7): siglas + habits compartilhados. */
    batchContext?: BatchSearchContext | null;
};

export type SearchProdutosPickSummary = {
    embalagemId: string;
    label: string;
    price: number | null;
    productName: string | null;
};

export type SearchProdutosForAiResult = {
    body: Record<string, unknown>;
    allowlistIds: string[];
    lastSearchPicks: SearchProdutosPickSummary[];
    wasEmpty: boolean;
    pendingPickGroup: PendingPickGroup | null;
};

/** Fase catálogo (I/O) — antes da disambiguação com habits coalescidos. */
export type CatalogSearchPhaseResult = {
    query: string;
    rows: ChatProdutoRow[];
    didYouMean: Array<{ id: string; label: string; score: number }>;
    queryNormalized: string;
    empty: boolean;
    productIds: string[];
};

async function resolvePackagingHabitForRows(
    deps: SearchProdutosForAiDeps,
    rows: Array<{ produto_id?: string | null }>
): Promise<string | null> {
    if (deps.batchContext) {
        return habitSiglaForProductIds(
            deps.batchContext,
            rows.map((r) => r.produto_id)
        );
    }
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

export async function fetchCatalogRowsForAi(
    input: SearchProdutosForAiInput,
    deps: SearchProdutosForAiDeps
): Promise<CatalogSearchPhaseResult> {
    if (deps.batchContext?.signal?.aborted) {
        throw new Error("batch_search_aborted");
    }
    const query = input.query;
    const categoryHint = input.categoryHint ?? null;
    const detailed = await deps.catalog.searchDetailed(deps.companyId, query, {
        categoryHint,
        limit: 8,
    });

    const pool = await expandPoolWithTagVolumeSiblings(
        deps,
        detailed.items as ChatProdutoRow[],
        query
    );
    const rows = preferRowsMatchingTagAliases(
        pool as TagAliasRow[],
        query,
        deps.userText
    ) as ChatProdutoRow[];

    const productIds = [
        ...new Set(
            rows
                .map((r) => String(r.produto_id ?? "").trim())
                .filter(Boolean)
        ),
    ];

    return {
        query,
        rows,
        didYouMean: detailed.didYouMean,
        queryNormalized: detailed.queryNormalized,
        empty: detailed.empty,
        productIds,
    };
}

export function finalizeSearchProdutosForAi(
    phase: CatalogSearchPhaseResult,
    deps: SearchProdutosForAiDeps,
    opts?: {
        companySiglas?: CompanySigla[];
        habitSigla?: string | null;
    }
): SearchProdutosForAiResult {
    let rows = phase.rows;
    if (rows.length >= 2) {
        const companySiglas = opts?.companySiglas ?? deps.batchContext?.companySiglas ?? [];
        const habitSigla =
            opts?.habitSigla !== undefined
                ? opts.habitSigla
                : deps.batchContext
                  ? habitSiglaForProductIds(
                        deps.batchContext,
                        rows.map((r) => r.produto_id)
                    )
                  : null;
        rows = disambiguatePackagingForSearchRows(rows, phase.query, deps.userText, {
            companySiglas,
            habitSigla,
        });
    }

    const publicItems = rows.map((r) =>
        toChatCatalogPublicItem(r as unknown as Record<string, unknown>)
    );
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
                  ...(phase.didYouMean.length
                      ? [
                            `did_you_mean: ${phase.didYouMean.map((d) => d.label).join(" | ")}. Ofereça essas opções se o cliente digitou errado.`,
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
    const fromLine =
        deps.worklistLineQuantity != null &&
        Number.isFinite(deps.worklistLineQuantity) &&
        deps.worklistLineQuantity >= 1
            ? Math.floor(deps.worklistLineQuantity)
            : null;
    const requestedQuantity = fromLine ?? extractQuantityNearQuery(phase.query, deps.userText);

    const wantSigla = explicitCommercialSiglaNearQuery(phase.query, deps.userText);
    const hitSiglas = [
        ...new Set(
            rows
                .map((r) => String(r.sigla_comercial ?? "").trim().toUpperCase())
                .filter(Boolean)
        ),
    ];
    const packagingMismatch =
        Boolean(wantSigla) && hitSiglas.length > 0 && !hitSiglas.includes(wantSigla!);

    const lineId = deps.worklistLineId ?? `search_${productKeyFromQuery(phase.query)}`;
    const label =
        sameFamily || packagingMismatch
            ? String(rows[0]?.product_name ?? phase.query).trim() || phase.query
            : phase.query.trim() || String(rows[0]?.product_name ?? "Item");

    /**
     * Ambíguo (2+) OU mismatch de embalagem (pediu CX, só UN): PendingPickGroup
     * — não auto-prepare; clarify com aviso (smoke jamel).
     */
    const pendingPickGroup =
        rows.length >= 2 || (packagingMismatch && rows.length >= 1)
            ? buildPendingPickGroup(
                  productKeyFromQuery(phase.query),
                  label,
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
                      lineId,
                      ...(packagingMismatch
                          ? { unavailableRequestedSigla: wantSigla }
                          : {}),
                  }
              )
            : null;

    if (packagingMismatch && pendingPickGroup) {
        guidanceForModelPt.push(
            `Cliente pediu embalagem ${wantSigla} que não existe neste produto. ` +
                "NÃO chame prepare_order_draft — o servidor pergunta se aceita a opção disponível."
        );
    }

    return {
        body: {
            items: publicItems,
            did_you_mean: phase.didYouMean,
            query_normalized: phase.queryNormalized,
            produto_embalagem_ids_validos: allowlistIds,
            guidance_for_model_pt: guidanceForModelPt,
        },
        allowlistIds,
        lastSearchPicks,
        wasEmpty: phase.empty,
        pendingPickGroup,
    };
}

export async function runSearchProdutosForAi(
    input: SearchProdutosForAiInput,
    deps: SearchProdutosForAiDeps
): Promise<SearchProdutosForAiResult> {
    const phase = await fetchCatalogRowsForAi(input, deps);

    let companySiglas: CompanySigla[] = deps.batchContext?.companySiglas ?? [];
    let habitSigla: string | null = null;
    if (phase.rows.length >= 2) {
        try {
            if (deps.batchContext) {
                habitSigla = habitSiglaForProductIds(
                    deps.batchContext,
                    phase.rows.map((r) => r.produto_id)
                );
            } else {
                const [siglas, habit] = await Promise.all([
                    companySiglas.length
                        ? Promise.resolve(companySiglas)
                        : loadCompanySiglas(deps.admin, deps.companyId),
                    resolvePackagingHabitForRows(deps, phase.rows),
                ]);
                companySiglas = siglas;
                habitSigla = habit;
            }
        } catch (err: unknown) {
            console.warn(
                "[searchProdutosForAi] sigla/habit load failed",
                err instanceof Error ? err.message : err
            );
        }
    }

    return finalizeSearchProdutosForAi(phase, deps, { companySiglas, habitSigla });
}
