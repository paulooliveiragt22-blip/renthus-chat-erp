import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { presentBlockedReasonForModel } from "../../src/pro/adapters/ai/blockedReasonPresenter";

describe("presentBlockedReasonForModel", () => {
    it("MISSING_ITEMS", () => {
        const g = presentBlockedReasonForModel({ code: "MISSING_ITEMS" });
        assert.ok(g.some((l) => l.toLowerCase().includes("items")));
    });

    it("ADDRESS_INCOMPLETE", () => {
        const g = presentBlockedReasonForModel({ code: "ADDRESS_INCOMPLETE" });
        assert.ok(g.some((l) => l.toLowerCase().includes("endereço") || l.toLowerCase().includes("endereco")));
    });

    it("OUT_OF_DELIVERY_ZONE inclui o bairro", () => {
        const g = presentBlockedReasonForModel({ code: "OUT_OF_DELIVERY_ZONE", neighborhood: "Centro" });
        assert.ok(g.some((l) => l.includes("Centro")));
    });

    it("BELOW_MIN_ORDER inclui valores formatados em BRL", () => {
        const g = presentBlockedReasonForModel({ code: "BELOW_MIN_ORDER", missing: 12.5, minOrder: 50 });
        const blob = g.join("\n");
        assert.ok(blob.includes("12,50"));
        assert.ok(blob.includes("50,00"));
        assert.ok(blob.toLowerCase().includes("não pergunte forma de pagamento") || blob.toLowerCase().includes("nao pergunte forma de pagamento"));
    });

    it("PAYMENT_MISSING", () => {
        const g = presentBlockedReasonForModel({ code: "PAYMENT_MISSING" });
        assert.ok(g.some((l) => /pix|cartão|cartao|dinheiro/i.test(l)));
    });

    it("INVALID_CHANGE_FOR inclui os dois valores", () => {
        const g = presentBlockedReasonForModel({ code: "INVALID_CHANGE_FOR", grandTotal: 50, changeFor: 20 });
        const blob = g.join("\n");
        assert.ok(blob.includes("20,00"));
        assert.ok(blob.includes("50,00"));
    });

    it("FIX_ERRORS devolve vazio (tratado pelo fallback dinâmico de errors[])", () => {
        assert.deepEqual(presentBlockedReasonForModel({ code: "FIX_ERRORS" }), []);
    });
});
