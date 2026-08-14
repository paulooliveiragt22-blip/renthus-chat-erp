import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import { checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";

function draftWithItemsNoAddress(): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "Heineken UN",
                quantity: 2,
                unitPrice: 10,
                fatorConversao: 1,
                productVolumeId: null,
                estoqueUnidades: 9,
            },
        ],
        address: null,
        paymentMethod: null,
        changeFor: null,
        fulfillmentType: "delivery",
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 20,
        grandTotal: 20,
        pendingConfirmation: false,
        version: 1,
    };
}

function state(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: "c1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: draftWithItemsNoAddress(),
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

const savedAddresses = [
    {
        id: "addr-primary",
        apelido: null,
        logradouro: "Rua das Flores",
        numero: "100",
        complemento: null,
        bairro: "Centro",
        cidade: "Sorriso",
        estado: "MT",
        cep: null,
        is_principal: true,
        delivery_count: 10,
        last_delivered_at: "2025-01-01",
    },
    {
        id: "addr-secondary",
        apelido: "Trabalho",
        logradouro: "Av. Brasil",
        numero: "200",
        complemento: null,
        bairro: "Industrial",
        cidade: "Sorriso",
        estado: "MT",
        cep: null,
        is_principal: false,
        delivery_count: 2,
        last_delivered_at: "2026-06-01",
    },
];

function hintsWithTwoCandidates(): Record<string, unknown> {
    return {
        customer_known: true,
        requires_address_flow_registration: false,
        saved_addresses: savedAddresses,
        most_used_address_id: "addr-primary",
        last_used_address_id: "addr-secondary",
    };
}

describe("checkoutPostProcess — botões de escolha de endereço", () => {
    it("2 candidatos diferentes (mais usado vs último pedido) → mostra botões", () => {
        const out = checkoutPostProcess({
            state: state(),
            outbound: [{ kind: "text", text: "Show." }],
            mode: "ai",
            orderHints: hintsWithTwoCandidates(),
        });
        const buttons = out.outbound.find((m) => m.kind === "buttons");
        assert.ok(buttons, "esperava mensagem de botões de endereço");
        assert.equal(buttons!.buttons?.length, 3);
        assert.ok(buttons!.buttons?.some((b) => b.id === "pro_pick_address:addr-primary"));
        assert.ok(buttons!.buttons?.some((b) => b.id === "pro_pick_address:addr-secondary"));
        assert.ok(buttons!.buttons?.some((b) => b.id === "pro_new_address_flow"));
        // Rótulo customizado (apelido != "Principal") aparece no botão.
        assert.ok(buttons!.buttons?.some((b) => b.title === "Trabalho"));
    });

    it("ADDR_FREE_TEXT sinalizado pela IA → não mostra botões", () => {
        const out = checkoutPostProcess({
            state: state(),
            outbound: [{ kind: "text", text: "Tenho Rua das Flores, 100 cadastrado..." }],
            mode: "ai",
            orderHints: hintsWithTwoCandidates(),
            addressFreeTextSignaled: true,
        });
        assert.ok(!out.outbound.some((m) => m.kind === "buttons"));
    });

    it("só 1 endereço salvo → sem botões (fluxo normal)", () => {
        const out = checkoutPostProcess({
            state: state(),
            outbound: [{ kind: "text", text: "Show." }],
            mode: "ai",
            orderHints: {
                customer_known: true,
                requires_address_flow_registration: false,
                saved_addresses: [savedAddresses[0]],
                most_used_address_id: "addr-primary",
                last_used_address_id: "addr-primary",
            },
        });
        assert.ok(!out.outbound.some((m) => m.kind === "buttons"));
    });

    it("most_used e last_used iguais → sem botões", () => {
        const out = checkoutPostProcess({
            state: state(),
            outbound: [{ kind: "text", text: "Show." }],
            mode: "ai",
            orderHints: {
                customer_known: true,
                requires_address_flow_registration: false,
                saved_addresses: savedAddresses,
                most_used_address_id: "addr-primary",
                last_used_address_id: "addr-primary",
            },
        });
        assert.ok(!out.outbound.some((m) => m.kind === "buttons"));
    });

    it("endereço já completo no draft → sem botões (fluxo normal de pagamento)", () => {
        const draft = { ...draftWithItemsNoAddress(), address: {
            logradouro: "Rua A",
            numero: "1",
            bairro: "Centro",
            cidade: "Sorriso",
            estado: "MT",
            complemento: null,
        } };
        const out = checkoutPostProcess({
            state: state({ draft }),
            outbound: [],
            mode: "ai",
            orderHints: hintsWithTwoCandidates(),
        });
        assert.ok(!out.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id.startsWith("pro_pick_address:"))));
    });
});
