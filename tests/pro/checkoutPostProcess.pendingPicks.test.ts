import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PendingPickGroup, ProSessionState } from "../../src/types/contracts";
import { checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";

function pendingGroups(): PendingPickGroup[] {
    return [
        {
            productKey: "skol lata",
            productLabel: "SKOL LATA",
            unresolvedTurns: 0,
            options: [
                {
                    embalagemId: "skol-un",
                    displayName: "SKOL LATA",
                    productName: "SKOL LATA",
                    siglaComercial: "UN",
                    precoVenda: 5,
                    fatorConversao: 1,
                },
                {
                    embalagemId: "skol-cx",
                    displayName: "SKOL LATA (CX c/15)",
                    productName: "SKOL LATA",
                    siglaComercial: "CX",
                    precoVenda: 60,
                    fatorConversao: 15,
                },
            ],
        },
        {
            productKey: "original 600ml",
            productLabel: "ORIGINAL 600ML",
            unresolvedTurns: 0,
            options: [
                {
                    embalagemId: "orig-un",
                    displayName: "ORIGINAL 600ML",
                    productName: "ORIGINAL 600ML",
                    siglaComercial: "UN",
                    precoVenda: 15,
                    fatorConversao: 1,
                },
                {
                    embalagemId: "orig-cx",
                    displayName: "ORIGINAL 600ML (CX c/24)",
                    productName: "ORIGINAL 600ML",
                    siglaComercial: "CX",
                    precoVenda: 360,
                    fatorConversao: 24,
                },
            ],
        },
    ];
}

describe("checkoutPostProcess: clarify_pending_picks (Frente 1)", () => {
    it("descarta o reply_text da IA e substitui por pergunta consolidada, sem botões", () => {
        const state: ProSessionState = {
            step: "pro_collecting_order",
            customerId: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            pendingPickGroups: pendingGroups(),
        };
        const out = checkoutPostProcess({
            state,
            outbound: [
                {
                    kind: "text",
                    text: "Ótimo! 🍺 Achei Skol e Original em várias opções. Qual tamanho/embalagem você prefere em cada uma?",
                },
            ],
            mode: "ai",
        });

        assert.equal(out.outbound.length, 1);
        assert.equal(out.outbound[0]!.kind, "text");
        const text = out.outbound[0]!.text ?? "";
        assert.match(text, /SKOL LATA/);
        assert.match(text, /ORIGINAL 600ML/);
        assert.doesNotMatch(text, /Ótimo! 🍺/);
        assert.ok(!out.outbound.some((m) => m.kind === "buttons"));
    });

    it("nunca envia card de botão junto com a pergunta consolidada (rede de segurança não duplica)", () => {
        const state: ProSessionState = {
            step: "pro_collecting_order",
            customerId: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            pendingPickGroups: pendingGroups(),
            lastSearchPicks: [
                { embalagemId: "orig-un", label: "ORIGINAL 600ML" },
                { embalagemId: "orig-cx", label: "ORIGINAL 600ML (CX c/24)" },
            ],
        };
        const out = checkoutPostProcess({
            state,
            outbound: [{ kind: "text", text: "texto qualquer da IA" }],
            mode: "ai",
        });
        assert.equal(out.outbound.filter((m) => m.kind === "buttons").length, 0);
        assert.equal(out.outbound.filter((m) => m.kind === "text").length, 1);
    });

    it("com pendingPickGroups, não oferece botões de pagamento mesmo com draft parcial", () => {
        const state: ProSessionState = {
            step: "pro_collecting_order",
            customerId: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: {
                items: [
                    {
                        produtoEmbalagemId: "outro-item",
                        productName: "Item já resolvido",
                        quantity: 1,
                        unitPrice: 10,
                        fatorConversao: 1,
                        productVolumeId: null,
                        estoqueUnidades: 9,
                    },
                ],
                address: {
                    logradouro: "Rua A",
                    numero: "1",
                    bairro: "Centro",
                    cidade: "Sorriso",
                    estado: "MT",
                    complemento: null,
                },
                paymentMethod: null,
                changeFor: null,
                deliveryFee: 15,
                deliveryZoneId: null,
                deliveryAddressText: null,
                deliveryMinOrder: null,
                deliveryEtaMin: null,
                totalItems: 10,
                grandTotal: 25,
                pendingConfirmation: false,
                version: 1,
            },
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            pendingPickGroups: pendingGroups(),
        };
        const out = checkoutPostProcess({ state, outbound: [], mode: "ai" });
        assert.ok(!out.outbound.some((m) => m.kind === "buttons"));
    });
});
