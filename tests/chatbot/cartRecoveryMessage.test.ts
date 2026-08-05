import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildCartRecoveryMessage,
    CART_RECOVERY_BUTTON_ID,
} from "../../lib/chatbot/outbound/cartRecoveryMessage";

const draft = {
    items: [
        { productName: "Heineken 600ml", quantity: 2 },
        { productName: "Água Mineral", quantity: 1 },
    ],
    deliveryFee: 5,
    grandTotal: 25,
};

describe("buildCartRecoveryMessage", () => {
    it("monta card com itens, total e botão de retomada", () => {
        const message = buildCartRecoveryMessage({ draft, customerName: "Maria Silva" });
        assert.ok(message);
        assert.equal(message.kind, "buttons");
        assert.match(message.text, /^Maria,/u);
        assert.match(message.text, /2x Heineken 600ml/u);
        assert.match(message.text, /Total: R\$ 25,00 \(com taxa de R\$ 5,00\)/u);
        assert.equal(message.kind === "buttons" && message.buttons[0].id, CART_RECOVERY_BUTTON_ID);
    });

    it("todos os botões respeitam o limite de 20 chars do WhatsApp", () => {
        const message = buildCartRecoveryMessage({ draft });
        assert.ok(message && message.kind === "buttons");
        for (const button of message.buttons) {
            assert.ok(button.title.length <= 20, `botão longo: ${button.title}`);
        }
    });

    it("resume itens acima de três", () => {
        const message = buildCartRecoveryMessage({
            draft: {
                items: [
                    { productName: "A", quantity: 1 },
                    { productName: "B", quantity: 1 },
                    { productName: "C", quantity: 1 },
                    { productName: "D", quantity: 1 },
                    { productName: "E", quantity: 1 },
                ],
                grandTotal: 10,
            },
        });
        assert.ok(message);
        assert.match(message.text, /e mais 2 itens/u);
    });

    it("ignora itens inválidos e devolve null quando não sobra nada", () => {
        assert.equal(
            buildCartRecoveryMessage({ draft: { items: [{ productName: "", quantity: 0 }] } }),
            null
        );
        assert.equal(buildCartRecoveryMessage({ draft: { items: [] } }), null);
        assert.equal(buildCartRecoveryMessage({ draft: null }), null);
    });

    it("sem taxa não inventa linha de taxa", () => {
        const message = buildCartRecoveryMessage({
            draft: { items: [{ productName: "Skol", quantity: 6 }], grandTotal: 22.8, deliveryFee: 0 },
        });
        assert.ok(message);
        assert.match(message.text, /Total: R\$ 22,80$/mu);
    });
});
