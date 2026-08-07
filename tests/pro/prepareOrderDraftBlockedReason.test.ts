import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareOrderDraftFromTool } from "../../src/pro/tools/prepareOrderDraft";
import type { PrepareDraftToolInput } from "@/src/types/contracts";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const PACK_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Admin fake: 1 embalagem válida (UN, R$ 50,00, sem controle de estoque), sem consultas de endereço. */
function fakeAdmin(): SupabaseClient {
    return {
        from(table: string) {
            if (table === "view_chat_produtos") {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    maybeSingle: async () => ({
                                        data: {
                                            id: PACK_ID,
                                            company_id: COMPANY_ID,
                                            product_name: "Produto Teste",
                                            display_name: "Produto Teste UN",
                                            descricao: null,
                                            sigla_comercial: "UN",
                                            volume_quantidade: null,
                                            unit_type_sigla: null,
                                            preco_venda: "50.00",
                                            fator_conversao: "1",
                                            product_volume_id: null,
                                            estoque_unidades: 999,
                                            vender_com_estoque_zero: true,
                                            produto_id: "produto-teste-id",
                                        },
                                    }),
                                };
                            },
                        };
                    },
                };
            }
            return {
                select() {
                    return {
                        eq() {
                            return {
                                eq() {
                                    return { maybeSingle: async () => ({ data: null }) };
                                },
                                maybeSingle: async () => ({ data: null }),
                            };
                        },
                    };
                },
            };
        },
    } as unknown as SupabaseClient;
}

/**
 * Endereço completo válido — `resolveDeliveryForNeighborhood` cai no fallback genérico do
 * `fakeAdmin()` (companies/company_delivery_policy inexistentes → `service_by_zone` false →
 * atende toda a cidade, sem taxa, sem mínimo), então não bloqueia por endereço/mínimo.
 */
function baseInput(overrides: Partial<PrepareDraftToolInput> = {}): PrepareDraftToolInput {
    return {
        items: [{ produtoEmbalagemId: PACK_ID, quantity: 1 }],
        address: {
            logradouro: "Rua Teste",
            numero: "100",
            bairro: "Centro",
            complemento: null,
            cidade: "São Paulo",
            estado: "SP",
            cep: null,
        },
        addressRaw: null,
        savedAddressId: null,
        useSavedAddress: false,
        paymentMethod: "pix",
        changeFor: null,
        readyForConfirmation: false,
        ...overrides,
    };
}

describe("prepareOrderDraftFromTool / blocked (motivo tipado)", () => {
    it("sem items → blocked.code MISSING_ITEMS", async () => {
        const res = await prepareOrderDraftFromTool(
            fakeAdmin(),
            COMPANY_ID,
            null,
            baseInput({ items: [] })
        );
        assert.equal(res.ok, false);
        assert.equal(res.blocked?.code, "MISSING_ITEMS");
    });

    it("sem payment_method → blocked.code PAYMENT_MISSING", async () => {
        const res = await prepareOrderDraftFromTool(
            fakeAdmin(),
            COMPANY_ID,
            null,
            baseInput({ paymentMethod: null })
        );
        assert.equal(res.ok, false);
        assert.equal(res.blocked?.code, "PAYMENT_MISSING");
    });

    it("dinheiro com troco menor que o total → blocked.code INVALID_CHANGE_FOR (bug real corrigido)", async () => {
        const res = await prepareOrderDraftFromTool(
            fakeAdmin(),
            COMPANY_ID,
            null,
            baseInput({ paymentMethod: "cash", changeFor: 20 }) // total = R$ 50, troco = R$ 20
        );
        assert.equal(res.ok, false);
        assert.equal(res.blocked?.code, "INVALID_CHANGE_FOR");
        if (res.blocked?.code === "INVALID_CHANGE_FOR") {
            assert.equal(res.blocked.grandTotal, 50);
            assert.equal(res.blocked.changeFor, 20);
        }
        assert.ok(res.errors.some((e) => /troco/i.test(e)));
    });

    it("dinheiro com troco suficiente → ok:true, blocked:null", async () => {
        const res = await prepareOrderDraftFromTool(
            fakeAdmin(),
            COMPANY_ID,
            null,
            baseInput({ paymentMethod: "cash", changeFor: 100 })
        );
        assert.equal(res.ok, true);
        assert.equal(res.blocked, null);
    });

    it("dinheiro sem troco informado (sem troco) → não bloqueia por INVALID_CHANGE_FOR", async () => {
        const res = await prepareOrderDraftFromTool(
            fakeAdmin(),
            COMPANY_ID,
            null,
            baseInput({ paymentMethod: "cash", changeFor: null })
        );
        assert.equal(res.ok, true);
        assert.equal(res.blocked, null);
    });

    it("pix/cartão com change_for presente é ignorado (não valida troco fora do dinheiro)", async () => {
        const res = await prepareOrderDraftFromTool(
            fakeAdmin(),
            COMPANY_ID,
            null,
            baseInput({ paymentMethod: "pix", changeFor: 1 })
        );
        assert.equal(res.ok, true);
        assert.equal(res.blocked, null);
    });

    it("tudo ok → blocked:null e ok:true", async () => {
        const res = await prepareOrderDraftFromTool(fakeAdmin(), COMPANY_ID, null, baseInput());
        assert.equal(res.ok, true);
        assert.equal(res.blocked, null);
        assert.equal(res.draft?.grandTotal, 50);
    });
});
