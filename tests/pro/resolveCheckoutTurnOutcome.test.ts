import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCheckoutTurnOutcome } from "../../src/pro/pipeline/resolveCheckoutTurnOutcome";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";

function draft(partial: Partial<OrderDraft> & { items: OrderDraft["items"] }): OrderDraft {
    return {
        address: null,
        paymentMethod: null,
        changeFor: null,
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 0,
        grandTotal: 0,
        pendingConfirmation: false,
        version: 1,
        ...partial,
    };
}

function state(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: "c1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

const addr = {
    logradouro: "Rua A",
    numero: "1",
    bairro: "Centro",
    cidade: "Sorriso",
    estado: "MT",
    complemento: null,
};

describe("resolveCheckoutTurnOutcome", () => {
    it("clarify_pending_picks tem prioridade sobre clarify_product_picks quando pendingPickGroups existe", () => {
        const out = resolveCheckoutTurnOutcome({
            mode: "ai",
            state: state({
                lastSearchPicks: [
                    { embalagemId: "a", label: "UN" },
                    { embalagemId: "b", label: "CX" },
                ],
                pendingPickGroups: [
                    {
                        productKey: "skol",
                        productLabel: "Skol",
                        unresolvedTurns: 0,
                        options: [
                            {
                                embalagemId: "a",
                                displayName: "SKOL LATA",
                                productName: "SKOL LATA",
                                siglaComercial: "UN",
                                precoVenda: 5,
                                fatorConversao: 1,
                            },
                            {
                                embalagemId: "b",
                                displayName: "SKOL LATA (CX c/15)",
                                productName: "SKOL LATA",
                                siglaComercial: "CX",
                                precoVenda: 60,
                                fatorConversao: 15,
                            },
                        ],
                    },
                ],
            }),
        });
        assert.equal(out.kind, "clarify_pending_picks");
    });

    it("sem pendingPickGroups: cai no clarify_product_picks legado com ≥2 lastSearchPicks", () => {
        const out = resolveCheckoutTurnOutcome({
            mode: "ai",
            state: state({
                pendingPickGroups: [],
                lastSearchPicks: [
                    { embalagemId: "a", label: "UN" },
                    { embalagemId: "b", label: "CX" },
                ],
            }),
        });
        assert.equal(out.kind, "clarify_product_picks");
    });

    it("clarify_pending_picks não dispara em pro_awaiting_confirmation", () => {
        const out = resolveCheckoutTurnOutcome({
            mode: "ai",
            state: state({
                step: "pro_awaiting_confirmation",
                pendingPickGroups: [
                    {
                        productKey: "skol",
                        productLabel: "Skol",
                        unresolvedTurns: 0,
                        options: [
                            {
                                embalagemId: "a",
                                displayName: "SKOL LATA",
                                productName: "SKOL LATA",
                                siglaComercial: "UN",
                                precoVenda: 5,
                                fatorConversao: 1,
                            },
                        ],
                    },
                ],
            }),
        });
        assert.notEqual(out.kind, "clarify_pending_picks");
    });

    it("clarify quando há ≥2 picks", () => {
        const out = resolveCheckoutTurnOutcome({
            mode: "ai",
            state: state({
                lastSearchPicks: [
                    { embalagemId: "a", label: "UN" },
                    { embalagemId: "b", label: "CX" },
                ],
            }),
        });
        assert.equal(out.kind, "clarify_product_picks");
    });

    it("ask_payment quando endereço UI ok sem pagamento", () => {
        const out = resolveCheckoutTurnOutcome({
            mode: "ai",
            state: state({
                deliveryAddressUiConfirmed: true,
                draft: draft({
                    items: [
                        {
                            produtoEmbalagemId: "x",
                            productName: "X",
                            quantity: 1,
                            unitPrice: 10,
                            fatorConversao: 1,
                            productVolumeId: null,
                            estoqueUnidades: 1,
                        },
                    ],
                    address: addr,
                }),
            }),
        });
        assert.equal(out.kind, "ask_payment");
    });

    it("confirm_order quando draft completo", () => {
        const out = resolveCheckoutTurnOutcome({
            mode: "direct_reply",
            state: state({
                step: "pro_awaiting_confirmation",
                deliveryAddressUiConfirmed: true,
                draft: draft({
                    items: [
                        {
                            produtoEmbalagemId: "x",
                            productName: "X",
                            quantity: 1,
                            unitPrice: 10,
                            fatorConversao: 1,
                            productVolumeId: null,
                            estoqueUnidades: 1,
                        },
                    ],
                    address: addr,
                    paymentMethod: "pix",
                    totalItems: 10,
                    grandTotal: 10,
                    pendingConfirmation: true,
                }),
            }),
        });
        assert.equal(out.kind, "confirm_order");
    });
});
