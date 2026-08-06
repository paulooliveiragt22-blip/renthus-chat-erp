import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    looksLikeFinalOrderConfirmAsk,
    scrubOutboundForAddressHold,
} from "../../src/pro/tools/checkoutPhasePolicy";
import { checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";

describe("checkoutPhasePolicy", () => {
    it("detecta pedido de confirmacao final", () => {
        assert.equal(
            looksLikeFinalOrderConfirmAsk("Pedido pronto! Digite sim para confirmar o pedido."),
            true
        );
        assert.equal(looksLikeFinalOrderConfirmAsk("Qual sabor voce quer?"), false);
    });

    it("scrub remove prosa de confirmacao final", () => {
        const out = scrubOutboundForAddressHold([
            { kind: "text", text: "Resumo: 1x X. Confirme o pedido com um sim." },
            {
                kind: "buttons",
                text: "Confirma endereco?",
                buttons: [{ id: "pro_confirm_typed_address", title: "Confirmar" }],
            },
        ]);
        assert.ok(out.some((m) => m.kind === "buttons"));
        assert.ok(!out.some((m) => m.kind === "text" && looksLikeFinalOrderConfirmAsk(m.text ?? "")));
    });
});

describe("checkoutPostProcess — resumo final canónico", () => {
    function draft(): OrderDraft {
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
            paymentMethod: "pix",
            changeFor: null,
            deliveryFee: 5,
            deliveryZoneId: null,
            deliveryAddressText: "Rua A, 1",
            deliveryMinOrder: null,
            deliveryEtaMin: null,
            totalItems: 10,
            grandTotal: 15,
            pendingConfirmation: true,
            version: 1,
        };
    }

    it("com draft completo: card Confirmar inclui taxa; sem CTA de endereço", () => {
        const state: ProSessionState = {
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft(),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            deliveryAddressUiConfirmed: false,
        };
        const r = checkoutPostProcess({
            state,
            mode: "ai",
            outbound: [
                {
                    kind: "text",
                    text: "Seu pedido esta pronto. Confirme o pedido digitando sim.",
                },
            ],
        });
        assert.equal(r.state.step, "pro_awaiting_confirmation");
        const confirm = r.outbound.find(
            (m) => m.kind === "buttons" && (m.buttons ?? []).some((b) => b.id === "pro_confirm_order")
        );
        assert.ok(confirm);
        assert.match(String(confirm?.text ?? ""), /Taxa de entrega: R\$ 5,00/);
        assert.match(String(confirm?.text ?? ""), /Total: R\$ 15,00/);
        assert.ok(
            !r.outbound.some(
                (m) => m.kind === "buttons" && (m.buttons ?? []).some((b) => b.id.includes("address"))
            )
        );
    });
});
