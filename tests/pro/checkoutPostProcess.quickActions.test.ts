import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import {
    applyQuickAction,
    buildOrderRecapText,
    checkoutPostProcessForQuickAction,
    strictCheckoutStructuredGate,
} from "../../src/pro/pipeline/stages/checkoutPostProcess";

function minimalDraft(overrides: Partial<OrderDraft> = {}): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "X",
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
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 10,
        grandTotal: 10,
        pendingConfirmation: false,
        version: 1,
        ...overrides,
    };
}

function state(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_idle",
        customerId: "c1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

describe("applyQuickAction — confirmação órfã e pagamento em texto", () => {
    it("pro_confirm_order sem draft em idle: não passa pela IA", () => {
        const r = applyQuickAction("pro_confirm_order", state({ step: "pro_idle", draft: null }));
        assert.equal(r.handled, true);
        assert.ok(r.outbound[0]?.kind === "text" && r.outbound[0].text?.includes("passo"));
    });

    it("pro_confirm_order sem draft em awaiting_confirmation: não consome (orderStage decide)", () => {
        const r = applyQuickAction(
            "pro_confirm_order",
            state({ step: "pro_awaiting_confirmation", draft: null })
        );
        assert.equal(r.handled, false);
    });

    it("strict gate: em coleta com endereco completo, cartão exige confirmar endereco (CTA)", () => {
        const g = strictCheckoutStructuredGate(
            "Cartão",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft(),
            })
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_address_before_payment");
        assert.ok(g.outbound.some((m) => m.kind === "buttons"));
    });

    it("strict gate: em awaiting_payment_method texto livre reenvia botoes de pagamento", () => {
        const g = strictCheckoutStructuredGate(
            "cartao",
            state({
                step: "pro_awaiting_payment_method",
                draft: minimalDraft(),
            })
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_payment_inbound_gate");
        assert.ok(g.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_pay_card")));
    });

    it("strict gate: pro_pay_pix em awaiting_payment passa (null)", () => {
        const g = strictCheckoutStructuredGate(
            "pro_pay_pix",
            state({
                step: "pro_awaiting_payment_method",
                draft: minimalDraft(),
            })
        );
        assert.equal(g, null);
    });

    it("cartao sem draft: não inventa pagamento", () => {
        const r = applyQuickAction("cartao", state({ draft: null }));
        assert.equal(r.handled, false);
    });

    it("pro_new_address_flow com flow: mesmo comportamento que Alterar", () => {
        const r = applyQuickAction(
            "pro_new_address_flow",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft(),
            }),
            {
                flowAddressRegister: {
                    flowId: "flow-meta-id",
                    threadId: "thread-1",
                    companyId: "company-1",
                },
            }
        );
        assert.equal(r.handled, true);
        assert.equal(r.outbound.length, 1);
        assert.equal(r.outbound[0]?.kind, "flow");
    });

    it("pro_edit_delivery_address com flow configurado: inclui mensagem de flow", () => {
        const r = applyQuickAction(
            "pro_edit_delivery_address",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft(),
            }),
            {
                flowAddressRegister: {
                    flowId: "flow-meta-id",
                    threadId: "thread-1",
                    companyId: "company-1",
                },
            }
        );
        assert.equal(r.handled, true);
        assert.equal(r.outbound.length, 1);
        const flow = r.outbound[0];
        assert.equal(flow?.kind, "flow");
        assert.equal(flow?.flow?.flowToken, "thread-1|company-1|address_register");
        assert.equal(flow?.flow?.ctaLabel, "Cadastrar endereço");
    });

    it("strict gate: com pagamento no draft e endereco nao confirmado na UI, pix exige confirmar endereco", () => {
        const g = strictCheckoutStructuredGate(
            "pix",
            state({
                step: "pro_awaiting_address_confirmation",
                draft: minimalDraft({ paymentMethod: "pix" }),
            })
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_address_before_payment");
        assert.ok(g.outbound.some((m) => m.kind === "buttons"));
    });

    it("buildOrderRecapText inclui taxa de entrega e total", () => {
        const t = buildOrderRecapText(
            minimalDraft({
                paymentMethod: "card",
                deliveryFee: 5,
                grandTotal: 15,
            })
        );
        assert.ok(t.includes("Resumo do pedido"));
        assert.ok(t.includes("Entrega"));
        assert.ok(t.includes("Total"));
    });

    it("checkoutPostProcessForQuickAction: textos antes dos botoes de confirmacao final", () => {
        const st = state({
            step: "pro_awaiting_confirmation",
            draft: minimalDraft({ paymentMethod: "card" }),
        });
        const ob = checkoutPostProcessForQuickAction({
            state: st,
            outbound: [{ kind: "text", text: "Linha de recap" }],
        });
        const firstInteractive = ob.findIndex((m) => m.kind === "buttons" || m.kind === "flow");
        assert.ok(firstInteractive >= 0);
        assert.ok(ob.slice(0, firstInteractive).every((m) => m.kind === "text"));
    });
});
