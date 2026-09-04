import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "../../src/pro/ports/catalog.port";
import type { SearchProdutosResult, ChatProdutoRow } from "../../src/pro/tools/searchProdutos";
import { runSearchProdutosForAi } from "../../src/pro/adapters/ai/tools/searchProdutosForAi";

function fakeAdmin(): SupabaseClient {
    return {} as unknown as SupabaseClient;
}

/** Admin com `.from("siglas_comerciais")...` encadeável, usado quando há ambiguidade de embalagem. */
function fakeAdminWithSiglas(): SupabaseClient {
    const builder = {
        select() {
            return builder;
        },
        eq() {
            return builder;
        },
        order() {
            return Promise.resolve({ data: [], error: null });
        },
    };
    return {
        from() {
            return builder;
        },
    } as unknown as SupabaseClient;
}

function makeRow(over: Partial<ChatProdutoRow>): ChatProdutoRow {
    return {
        id: "id-1",
        product_name: "Skol Lata",
        display_name: null,
        descricao: null,
        sigla_comercial: "UN",
        preco_venda: 4.5,
        volume_quantidade: 350,
        unit_type_sigla: "ml",
        fator_conversao: 1,
        product_volume_id: null,
        category_id: null,
        ...over,
    };
}

function catalogWith(items: ChatProdutoRow[], opts?: Partial<SearchProdutosResult>): CatalogPort {
    return {
        async searchDetailed() {
            return {
                items,
                didYouMean: [],
                empty: items.length === 0,
                queryNormalized: "skol",
                ...opts,
            };
        },
    };
}

describe("runSearchProdutosForAi", () => {
    it("uma opção clara: devolve item, allowlist com o id e guidance de item único", async () => {
        const result = await runSearchProdutosForAi(
            { query: "skol lata" },
            {
                admin: fakeAdmin(),
                catalog: catalogWith([makeRow({})]),
                companyId: "company-1",
                customerId: null,
                userText: "quero uma skol lata",
            }
        );
        assert.equal(result.allowlistIds.length, 1);
        assert.equal(result.allowlistIds[0], "id-1");
        assert.equal(result.wasEmpty, false);
        assert.equal(result.lastSearchPicks.length, 1);
        const blob = (result.body.guidance_for_model_pt as string[]).join("\n");
        assert.ok(blob.includes("JÁ disse a quantidade"));
        assert.equal((result.body as { items: unknown[] }).items.length, 1);
    });

    it("busca vazia: wasEmpty=true, allowlist vazio e guidance de nenhum item", async () => {
        const result = await runSearchProdutosForAi(
            { query: "produto-inexistente" },
            {
                admin: fakeAdmin(),
                catalog: catalogWith([]),
                companyId: "company-1",
                customerId: null,
                userText: "quero produto-inexistente",
            }
        );
        assert.equal(result.wasEmpty, true);
        assert.deepEqual(result.allowlistIds, []);
        const blob = (result.body.guidance_for_model_pt as string[]).join("\n");
        assert.ok(blob.includes("Nenhum item no catálogo"));
    });

    it("duas embalagens (UN/CX) da mesma família: guidance orienta esclarecimento, sem listar preço no texto", async () => {
        const result = await runSearchProdutosForAi(
            { query: "skol" },
            {
                admin: fakeAdminWithSiglas(),
                catalog: catalogWith([
                    makeRow({ id: "id-un", sigla_comercial: "UN" }),
                    makeRow({ id: "id-cx", sigla_comercial: "CX", fator_conversao: 12 }),
                ]),
                companyId: "company-1",
                customerId: null,
                userText: "quero skol",
            }
        );
        assert.equal(result.allowlistIds.length, 2);
        const blob = (result.body.guidance_for_model_pt as string[]).join("\n");
        assert.ok(blob.includes("Há mais de uma opção"));
        assert.ok(result.pendingPickGroup, "deve montar pendingPickGroup (mesma família)");
        assert.equal(result.pendingPickGroup?.options.length, 2);
        assert.equal(result.pendingPickGroup?.productKey, "skol");
    });

    it("2+ resultados com nomes DISTINTOS (não é a mesma família): ainda monta pendingPickGroup em texto livre", async () => {
        const result = await runSearchProdutosForAi(
            { query: "original" },
            {
                admin: fakeAdminWithSiglas(),
                catalog: catalogWith([
                    makeRow({
                        id: "id-600ml-un",
                        product_name: "Original 600ml",
                        display_name: "ORIGINAL 600ML",
                        sigla_comercial: "UN",
                    }),
                    makeRow({
                        id: "id-600ml-cx",
                        product_name: "Original 600ml",
                        display_name: "ORIGINAL 600ML (CX c/24)",
                        sigla_comercial: "CX",
                        fator_conversao: 24,
                    }),
                    makeRow({
                        id: "id-lata",
                        product_name: "Original Lata",
                        display_name: "ORIGINAL LATA",
                        sigla_comercial: "UN",
                    }),
                ]),
                companyId: "company-1",
                customerId: null,
                userText: "quero original",
            }
        );
        assert.equal(result.allowlistIds.length, 3);
        assert.ok(result.pendingPickGroup, "deve montar pendingPickGroup mesmo com nomes distintos");
        assert.equal(result.pendingPickGroup?.options.length, 3);
        assert.equal(result.pendingPickGroup?.productKey, "original");
        assert.equal(result.pendingPickGroup?.productLabel, "original");
    });

    it("'quero 2 MARMITA P' após enrich (product_name=display): 1 SKU, sem pending pick", async () => {
        const result = await runSearchProdutosForAi(
            { query: "marmita" },
            {
                admin: fakeAdminWithSiglas(),
                catalog: catalogWith([
                    makeRow({
                        id: "m-g",
                        product_name: "MARMITA G",
                        display_name: "MARMITA G",
                        descricao: "G",
                        produto_id: "marmita-pai",
                    }),
                    makeRow({
                        id: "m-p",
                        product_name: "MARMITA P",
                        display_name: "MARMITA P",
                        descricao: "P",
                        produto_id: "marmita-pai",
                    }),
                    makeRow({
                        id: "m-m",
                        product_name: "MARMITA M",
                        display_name: "MARMITA M",
                        descricao: "M",
                        produto_id: "marmita-pai",
                    }),
                ]),
                companyId: "company-1",
                customerId: null,
                userText: "quero 2 MARMITA P",
            }
        );
        assert.equal(result.allowlistIds.length, 1);
        assert.equal(result.allowlistIds[0], "m-p");
        assert.equal(result.pendingPickGroup, null);
        const blob = (result.body.guidance_for_model_pt as string[]).join("\n");
        assert.ok(blob.includes("JÁ disse a quantidade"));
    });

    it("did_you_mean presente: guidance cita as opções sugeridas", async () => {
        const result = await runSearchProdutosForAi(
            { query: "skoll" },
            {
                admin: fakeAdmin(),
                catalog: catalogWith([makeRow({})], {
                    didYouMean: [{ id: "id-1", label: "Skol Lata", score: 0.8 }],
                }),
                companyId: "company-1",
                customerId: null,
                userText: "quero skoll",
            }
        );
        const blob = (result.body.guidance_for_model_pt as string[]).join("\n");
        assert.ok(blob.includes("did_you_mean"));
        assert.ok(blob.includes("Skol Lata"));
    });
});
