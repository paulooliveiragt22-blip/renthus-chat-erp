import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import {
    applyQuickAction,
    checkoutPostProcess,
    checkoutPostProcessForQuickAction,
    strictCheckoutStructuredGate,
} from "../../src/pro/pipeline/stages/checkoutPostProcess";
import { cartReviewFingerprint, withResolvedSlotStep } from "../../src/pro/pipeline/orderSlotStep";

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

function reviewed(draft: ReturnType<typeof minimalDraft>, extras: Partial<ProSessionState> = {}) {
    return state({
        step: "pro_awaiting_payment_method",
        draft,
        deliveryAddressUiConfirmed: true,
        cartReviewAcknowledged: true,
        cartReviewFingerprint: cartReviewFingerprint(draft),
        ...extras,
    });
}

describe("applyQuickAction — pedido mínimo não atingido", () => {
    it("pro_pay_pix abaixo do mínimo: fica em collecting e avisa o valor faltante (sem pedir confirmação)", () => {
        const r = applyQuickAction(
            "pro_pay_pix",
            reviewed(minimalDraft({ deliveryMinOrder: 50, grandTotal: 10, totalItems: 10 }))
        );
        assert.equal(r.handled, true);
        assert.equal(r.state.step, "pro_collecting_order");
        assert.equal(r.state.draft?.paymentMethod, "pix");
        assert.ok(
            r.outbound.some(
                (m) => m.kind === "text" && /m.nimo/u.test(String(m.text)) && String(m.text).includes("50")
            )
        );
    });

    it("pro_pay_cash abaixo do mínimo: não pede troco ainda, avisa o valor faltante", () => {
        const r = applyQuickAction(
            "pro_pay_cash",
            reviewed(minimalDraft({ deliveryMinOrder: 50, grandTotal: 25, totalItems: 25 }))
        );
        assert.equal(r.state.step, "pro_collecting_order");
        assert.ok(!r.outbound.some((m) => m.kind === "text" && String(m.text).includes("Troco")));
        assert.ok(r.outbound.some((m) => m.kind === "text" && String(m.text).includes("25")));
    });

    it("checkoutPostProcessForQuickAction não mostra botões de pagamento abaixo do mínimo", () => {
        const s = withResolvedSlotStep(
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ deliveryMinOrder: 50, grandTotal: 10, totalItems: 10 }),
            })
        );
        assert.equal(s.step, "pro_collecting_order");
        const out = checkoutPostProcessForQuickAction({ state: s, outbound: [] });
        assert.ok(!out.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_pay_pix")));
    });

    it("strict gate: abaixo do mínimo não trava texto livre (passo não chega a awaiting_payment_method)", () => {
        const s = withResolvedSlotStep(
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ deliveryMinOrder: 50, grandTotal: 10, totalItems: 10 }),
            })
        );
        assert.equal(s.step, "pro_collecting_order");
        const g = strictCheckoutStructuredGate("1 caixa de original lata", s);
        assert.equal(g, null);
    });
});

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

    it("pro_confirm_order no resumo: libera pagamento e não persiste", () => {
        const r = applyQuickAction(
            "pro_confirm_order",
            state({
                step: "pro_awaiting_cart_review",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(r.handled, true);
        assert.equal(r.actionTag, "pro_cart_review_ack");
        assert.equal(r.state.cartReviewAcknowledged, true);
        assert.equal(r.state.draft?.paymentMethod ?? null, null);
        assert.equal(r.state.step, "pro_awaiting_payment_method");
        const out = checkoutPostProcessForQuickAction({ state: r.state, outbound: r.outbound });
        assert.ok(out.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_pay_pix")));
        assert.ok(!out.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order")));
    });

    it("pro_confirm_order no resumo com PIX já no draft: mantém PIX (não zera)", () => {
        const r = applyQuickAction(
            "pro_confirm_order",
            state({
                step: "pro_awaiting_cart_review",
                draft: minimalDraft({ fulfillmentType: "delivery", paymentMethod: "pix" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(r.handled, true);
        assert.equal(r.actionTag, "pro_cart_review_ack");
        assert.equal(r.state.cartReviewAcknowledged, true);
        assert.equal(r.state.draft?.paymentMethod, "pix");
        assert.equal(r.state.step, "pro_awaiting_confirmation");
    });

    it("pro_confirm_order no resumo com dinheiro: pede troco", () => {
        const r = applyQuickAction(
            "pro_confirm_order",
            state({
                step: "pro_awaiting_cart_review",
                draft: minimalDraft({ fulfillmentType: "delivery", paymentMethod: "cash" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(r.state.step, "pro_awaiting_change_amount");
        assert.ok(r.outbound.some((m) => m.kind === "text" && /Troco/i.test(String(m.text))));
    });

    it("pro_pay_pix antes do resumo: não grava pagamento e reenvia o resumo", () => {
        const r = applyQuickAction(
            "pro_pay_pix",
            state({
                step: "pro_awaiting_cart_review",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(r.handled, true);
        assert.equal(r.actionTag, "payment_before_cart_review");
        assert.equal(r.state.draft?.paymentMethod ?? null, null);
        assert.ok(
            r.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order"))
        );
    });

    it("strict gate: em coleta com endereco completo, texto Cartão não bloqueia por endereço", () => {
        const g = strictCheckoutStructuredGate(
            "Cartão",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
            })
        );
        assert.equal(g, null);
    });

    it("strict gate: em awaiting_payment_method texto livre reenvia botoes de pagamento", () => {
        const g = strictCheckoutStructuredGate(
            "cartao",
            state({
                step: "pro_awaiting_payment_method",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
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
                draft: minimalDraft({ fulfillmentType: "delivery" }),
            })
        );
        assert.equal(g, null);
    });

    it("strict gate: pick de embalagem não é barrado em awaiting_payment", () => {
        const g = strictCheckoutStructuredGate(
            "pro_pick_emb:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            state({
                step: "pro_awaiting_payment_method",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                lastSearchPicks: [
                    { embalagemId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", label: "SALGADINHO" },
                    { embalagemId: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", label: "SALGADINHO CX" },
                ],
            })
        );
        assert.equal(g, null);
    });

    it("quickAction não duplica card de pagamento se outbound já tem", () => {
        const payment = {
            kind: "buttons" as const,
            text: "Escolha a forma de pagamento:",
            buttons: [
                { id: "pro_pay_pix", title: "PIX" },
                { id: "pro_pay_card", title: "Cartão" },
                { id: "pro_pay_cash", title: "Dinheiro" },
            ],
        };
        const out = checkoutPostProcessForQuickAction({
            state: state({
                step: "pro_awaiting_payment_method",
                draft: minimalDraft(),
            }),
            outbound: [
                { kind: "text", text: "Use um dos botões abaixo para escolher o pagamento." },
                payment,
            ],
        });
        const payCards = out.filter(
            (m) =>
                m.kind === "buttons" && (m.buttons ?? []).some((b) => b.id === "pro_pay_pix")
        );
        assert.equal(payCards.length, 1);
    });

    it("cartao sem draft: não inventa pagamento", () => {
        const r = applyQuickAction("cartao", state({ draft: null }));
        assert.equal(r.handled, false);
    });

    it("pro_new_address_flow com handoff: CTA do cardápio", () => {
        const r = applyQuickAction(
            "pro_new_address_flow",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft(),
            }),
            {
                checkoutHandoffUrl: "https://app.renthus.com.br/c/loja?hc=tok&checkout=1",
            }
        );
        assert.equal(r.handled, true);
        assert.equal(r.outbound.length, 1);
        assert.equal(r.outbound[0]?.kind, "cta_url");
        assert.ok(r.outbound[0]?.ctaUrl?.url.includes("hc=tok"));
    });

    it("pro_edit_delivery_address com handoff: CTA cadastrar endereço", () => {
        const r = applyQuickAction(
            "pro_edit_delivery_address",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft(),
            }),
            {
                checkoutHandoffUrl: "https://app.renthus.com.br/c/loja?hc=tok&checkout=1",
            }
        );
        assert.equal(r.handled, true);
        assert.equal(r.outbound.length, 1);
        const msg = r.outbound[0];
        assert.equal(msg?.kind, "cta_url");
        assert.equal(msg?.ctaUrl?.displayText, "Cadastrar endereço");
        assert.ok(msg?.ctaUrl?.url.includes("checkout=1"));
    });

    it("strict gate: confirmação high-value — prosa pix reenvia o card Confirmar", () => {
        const g = strictCheckoutStructuredGate(
            "pix",
            state({
                step: "pro_awaiting_confirmation",
                draft: minimalDraft({ paymentMethod: "pix", fulfillmentType: "delivery" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_confirmation_inbound_gate");
        assert.ok(g.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order")));
    });

    it("strict gate: confirmação — botão Confirmar passa", () => {
        const g = strictCheckoutStructuredGate(
            "pro_confirm_order",
            state({
                step: "pro_awaiting_confirmation",
                draft: minimalDraft({ paymentMethod: "pix", fulfillmentType: "delivery" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(g, null);
    });

    it("Corrigir: hold sticky — não reenvia resumo de confirmação", () => {
        const r = applyQuickAction(
            "pro_edit_order",
            state({
                step: "pro_awaiting_confirmation",
                draft: minimalDraft({ paymentMethod: "pix" }),
                deliveryAddressUiConfirmed: true,
                lastSearchPicks: [
                    { embalagemId: "x", label: "HAMBURGUER VELHO", price: 1 },
                    { embalagemId: "y", label: "OUTRO", price: 2 },
                ],
            })
        );
        assert.equal(r.handled, true);
        assert.equal(r.state.checkoutEditHold, true);
        assert.equal(r.state.step, "pro_collecting_order");
        assert.equal(r.state.lastSearchPicks?.length ?? 0, 0);
        const synced = withResolvedSlotStep(r.state);
        assert.equal(synced.step, "pro_collecting_order");
        const out = checkoutPostProcessForQuickAction({ state: synced, outbound: r.outbound });
        assert.ok(out.some((m) => m.kind === "text" && String(m.text).includes("editar")));
        assert.ok(!out.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order")));
    });

    it("Adicionar produtos: hold sticky sem card de resumo", () => {
        const r = applyQuickAction(
            "pro_add_items",
            state({
                step: "pro_awaiting_confirmation",
                draft: minimalDraft({ paymentMethod: "pix" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(r.state.checkoutEditHold, true);
        const out = checkoutPostProcessForQuickAction({
            state: withResolvedSlotStep(r.state),
            outbound: r.outbound,
        });
        assert.ok(out.some((m) => m.kind === "text" && String(m.text).includes("adicionar")));
        assert.ok(!out.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order")));
    });
});

describe("applyQuickAction — entrega vs retirada", () => {
    it("pro_fulfillment_pickup zera taxa e não exige endereço", () => {
        const r = applyQuickAction(
            "pro_fulfillment_pickup",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ address: null, deliveryFee: 12, grandTotal: 22 }),
            })
        );
        assert.equal(r.handled, true);
        assert.equal(r.state.draft?.fulfillmentType, "pickup");
        assert.equal(r.state.draft?.deliveryFee, 0);
        assert.equal(r.state.draft?.grandTotal, 10);
        assert.ok(r.outbound.some((m) => m.kind === "text" && /retirada/i.test(String(m.text))));
    });

    it("pro_fulfillment_delivery marca entrega e deixa endereço pendente (oferta no pipeline)", () => {
        const r = applyQuickAction(
            "pro_fulfillment_delivery",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ address: null }),
            })
        );
        assert.equal(r.handled, true);
        assert.equal(r.state.draft?.fulfillmentType, "delivery");
        assert.equal(r.state.step, "pro_collecting_order");
        assert.equal(r.state.deliveryAddressUiConfirmed, false);
        /** Texto/botões da oferta vêm de `serverOfferDeliveryAddressAfterFulfillment` no pipeline. */
        assert.equal(r.outbound.length, 0);
    });

    it("título do botão WhatsApp (Entrega / Retirar no local) também aplica o modo", () => {
        const base = state({
            step: "pro_awaiting_payment_method",
            draft: minimalDraft({ fulfillmentType: null }),
        });
        const delivery = applyQuickAction("Entrega", base);
        assert.equal(delivery.handled, true);
        assert.equal(delivery.state.draft?.fulfillmentType, "delivery");
        const pickup = applyQuickAction("Retirar no local", base);
        assert.equal(pickup.handled, true);
        assert.equal(pickup.state.draft?.fulfillmentType, "pickup");
        assert.equal(pickup.state.step, "pro_awaiting_cart_review");
    });

    it("strict gate não engole clique de Entrega/Retirar em awaiting_payment_method", () => {
        const g = strictCheckoutStructuredGate(
            "pro_fulfillment_pickup",
            state({
                step: "pro_awaiting_payment_method",
                draft: minimalDraft({ fulfillmentType: null }),
            })
        );
        assert.equal(g, null);
    });

    it("checkoutPostProcess oferece Entrega / Retirar mesmo com lastSearchPicks residual se já há itens", () => {
        const out = checkoutPostProcess({
            state: state({
                step: "pro_collecting_order",
                draft: minimalDraft({
                    paymentMethod: null,
                    fulfillmentType: null,
                    address: null,
                }),
                lastSearchPicks: [
                    { embalagemId: "a", label: "A", price: 10 },
                    { embalagemId: "b", label: "B", price: 12 },
                ],
            }),
            outbound: [
                {
                    kind: "text",
                    text: "Perfeito! Anotei os itens. Agora preciso do seu endereço de entrega para seguir.",
                },
            ],
            mode: "ai",
            fulfillmentPolicy: { deliveriesEnabled: true, pickupEnabled: true },
        });
        const buttons = out.outbound.find((m) => m.kind === "buttons");
        assert.ok(buttons);
        assert.ok(buttons!.buttons?.some((b) => b.id === "pro_fulfillment_delivery"));
        assert.ok(buttons!.buttons?.some((b) => b.id === "pro_fulfillment_pickup"));
        assert.ok(
            !out.outbound.some(
                (m) => m.kind === "text" && /preciso do seu endere/i.test(String(m.text ?? ""))
            )
        );
        assert.ok(
            !out.outbound.some((m) => m.kind === "text"),
            "prosa da IA não deve acompanhar Entrega/Retirar"
        );
    });

    it("checkoutPostProcess: some opções extras / vou buscar quando já vai Entrega/Retirar", () => {
        const out = checkoutPostProcess({
            state: state({
                step: "pro_collecting_order",
                draft: minimalDraft({
                    paymentMethod: null,
                    fulfillmentType: null,
                    address: null,
                }),
            }),
            outbound: [
                {
                    kind: "text",
                    text:
                        "Oi! Sobre a Original lata em caixa — temos a **ORIGINAL LATA (CX c/15)** a R$ 60. " +
                        "Tem mais duas opções: ORIGINAL 600ML (CX c/24). Qual você prefere? " +
                        "Enquanto isso, vou buscar a Heineken longneck.",
                },
            ],
            mode: "ai",
            fulfillmentPolicy: { deliveriesEnabled: true, pickupEnabled: true },
        });
        assert.ok(out.outbound.some((m) => m.kind === "buttons"));
        assert.ok(!out.outbound.some((m) => m.kind === "text"));
    });

    it("checkoutPostProcess com endereço completo: infere entrega e vai ao resumo (não Entrega/Retirar)", () => {
        const out = checkoutPostProcess({
            state: state({
                step: "pro_collecting_order",
                draft: minimalDraft({ paymentMethod: null, fulfillmentType: null }),
            }),
            outbound: [],
            mode: "ai",
            fulfillmentPolicy: { deliveriesEnabled: true, pickupEnabled: true },
        });
        assert.equal(out.state.draft?.fulfillmentType, "delivery");
        assert.equal(out.state.step, "pro_awaiting_cart_review");
        assert.ok(
            out.outbound.some(
                (m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order")
            )
        );
        assert.ok(
            !out.outbound.some(
                (m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_fulfillment_delivery")
            )
        );
    });

    it("checkoutPostProcess oferece Entrega / Retirar quando os dois modos estão ligados", () => {
        const out = checkoutPostProcess({
            state: state({
                step: "pro_collecting_order",
                draft: minimalDraft({ address: null, paymentMethod: null }),
            }),
            outbound: [],
            mode: "ai",
            fulfillmentPolicy: { deliveriesEnabled: true, pickupEnabled: true },
        });
        const buttons = out.outbound.find((m) => m.kind === "buttons");
        assert.ok(buttons);
        assert.ok(buttons!.buttons?.some((b) => b.id === "pro_fulfillment_delivery"));
        assert.ok(buttons!.buttons?.some((b) => b.id === "pro_fulfillment_pickup"));
        assert.ok(!buttons!.buttons?.some((b) => b.id === "pro_pay_pix"));
    });

    it("strict gate: Entrega/Retirar aberto — texto de item reenvia botões", () => {
        const g = strictCheckoutStructuredGate(
            "2 skol lata",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({
                    fulfillmentType: null,
                    paymentMethod: null,
                    address: null,
                }),
            }),
            undefined,
            { deliveriesEnabled: true, pickupEnabled: true }
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_fulfillment_inbound_gate");
        assert.ok(
            g.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_fulfillment_delivery"))
        );
    });

    it("strict gate: Entrega/Retirar — título Entrega passa", () => {
        const g = strictCheckoutStructuredGate(
            "Entrega",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({
                    fulfillmentType: null,
                    paymentMethod: null,
                    address: null,
                }),
            }),
            undefined,
            { deliveriesEnabled: true, pickupEnabled: true }
        );
        assert.equal(g, null);
    });

    it("retirada genérica em texto não aplica modalidade", () => {
        const r = applyQuickAction(
            "retirada",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ fulfillmentType: null }),
            })
        );
        assert.equal(r.handled, false);
        assert.equal(r.state.draft?.fulfillmentType ?? null, null);
    });

    it("loja só retirada: checkoutPostProcess aplica pickup e oferece resumo (não pagamento)", () => {
        const out = checkoutPostProcess({
            state: state({
                step: "pro_collecting_order",
                draft: minimalDraft({ address: null, paymentMethod: null, deliveryFee: 9 }),
            }),
            outbound: [],
            mode: "ai",
            fulfillmentPolicy: { deliveriesEnabled: false, pickupEnabled: true },
        });
        assert.equal(out.state.draft?.fulfillmentType, "pickup");
        assert.equal(out.state.draft?.deliveryFee, 0);
        assert.equal(out.state.step, "pro_awaiting_cart_review");
        assert.ok(
            out.outbound.some(
                (m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order")
            )
        );
        assert.ok(
            !out.outbound.some(
                (m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_pay_pix")
            )
        );
    });
});

describe("strictCheckoutStructuredGate — resumo, OOS e escalação", () => {
    it("resumo: sim/pode fechar reenvia o card (não confirma)", () => {
        const g = strictCheckoutStructuredGate(
            "sim pode fechar",
            state({
                step: "pro_awaiting_cart_review",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_cart_review_inbound_gate");
        assert.ok(
            g.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order"))
        );
    });

    it("resumo: revisão real de itens passa", () => {
        const g = strictCheckoutStructuredGate(
            "quero 2 skol lata",
            state({
                step: "pro_awaiting_cart_review",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(g, null);
    });

    it("resumo: Confirmar passa", () => {
        const g = strictCheckoutStructuredGate(
            "pro_confirm_order",
            state({
                step: "pro_awaiting_cart_review",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                deliveryAddressUiConfirmed: true,
            })
        );
        assert.equal(g, null);
    });

    it("OOS: ss/yes reenvia card; Sim exacto adiciona", () => {
        const withOffer = state({
            draft: minimalDraft(),
            pendingOutOfStockOffer: { names: ["SALGADINHO"] },
        });
        const ss = applyQuickAction("ss", withOffer);
        assert.equal(ss.actionTag, "pro_oos_offer_repeat");
        const sim = applyQuickAction("Sim", withOffer);
        assert.equal(sim.actionTag, "pro_oos_add_other");
    });

    it("escalação: prosa reenvia Atendente / Continuar", () => {
        const g = strictCheckoutStructuredGate(
            "cartao",
            state({ step: "pro_escalation_choice", draft: null })
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_escalation_inbound_gate");
        assert.ok(g.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "btn_support")));
        assert.ok(g.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "btn_order")));
    });

    it("escalação: btn_support e atendente passam", () => {
        const s = state({ step: "pro_escalation_choice", draft: null });
        assert.equal(strictCheckoutStructuredGate("btn_support", s), null);
        assert.equal(strictCheckoutStructuredGate("atendente", s), null);
    });

    it("oferta de endereço: texto livre reenvia Confirmar/Novo", () => {
        const g = strictCheckoutStructuredGate(
            "pode ser no centro",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                pendingAddressPickOptions: [
                    { id: "a1", label: "Rua B" },
                    { id: "a2", label: "Rua C" },
                ],
            })
        );
        assert.ok(g && g.handled);
        assert.equal(g.actionTag, "strict_address_offer_inbound_gate");
    });

    it("oferta de endereço: 2 passa", () => {
        const g = strictCheckoutStructuredGate(
            "2",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft({ fulfillmentType: "delivery" }),
                pendingAddressPickOptions: [
                    { id: "a1", label: "Rua B" },
                    { id: "a2", label: "Rua C" },
                ],
            })
        );
        assert.equal(g, null);
    });

    it("checkoutPostProcess em escalação envia botões", () => {
        const out = checkoutPostProcess({
            state: state({ step: "pro_escalation_choice", draft: null }),
            outbound: [{ kind: "text", text: "Não estou conseguindo entender bem." }],
            mode: "ai",
        });
        assert.ok(
            out.outbound.some((m) => m.kind === "buttons" && m.buttons?.some((b) => b.id === "btn_support"))
        );
    });
});
