import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    looksLikeCheckoutAffirmation,
    looksLikeNonMoneyWhileAwaitingChange,
    parsePtMoneyInput,
    userTextMentionsPayment,
} from "../../src/pro/pipeline/paymentFromUserText";
import { sanitizePreparePaymentAgainstUserText } from "../../src/pro/pipeline/sanitizePreparePayment";
import { stripHallucinatedOrderPersistenceClaims } from "../../src/pro/adapters/ai/sanitizeAiVisibleOrderClaims";
import type { PrepareDraftToolInput } from "../../src/types/contracts";

describe("parsePtMoneyInput", () => {
    it("aceita valor de troco", () => {
        assert.equal(parsePtMoneyInput("100"), 100);
        assert.equal(parsePtMoneyInput("50,00"), 50);
        assert.equal(parsePtMoneyInput("R$ 20"), 20);
    });
    it("rejeita produto com dígito (não é troco)", () => {
        assert.equal(parsePtMoneyInput("boa noite tem coca 2l?"), null);
        assert.equal(parsePtMoneyInput("exatament"), null);
        assert.equal(parsePtMoneyInput("quero 3 coca"), null);
    });
});

describe("looksLikeCheckoutAffirmation", () => {
    it("reconhece exatamente / sim", () => {
        assert.equal(looksLikeCheckoutAffirmation("exatament"), true);
        assert.equal(looksLikeCheckoutAffirmation("sim"), true);
        assert.equal(looksLikeCheckoutAffirmation("pix"), false);
    });
});

describe("looksLikeNonMoneyWhileAwaitingChange", () => {
    it("libera FAQ e afirmação", () => {
        assert.equal(looksLikeNonMoneyWhileAwaitingChange("tem coca 2l?"), true);
        assert.equal(looksLikeNonMoneyWhileAwaitingChange("exatamente"), true);
        assert.equal(looksLikeNonMoneyWhileAwaitingChange("100"), false);
    });
});

describe("sanitizePreparePaymentAgainstUserText", () => {
    const base: PrepareDraftToolInput = {
        items: [{ produtoEmbalagemId: "a", quantity: 1 }],
        address: null,
        addressRaw: null,
        savedAddressId: null,
        useSavedAddress: true,
        paymentMethod: "cash",
        changeFor: 2,
        readyForConfirmation: false,
    };

    it("remove pagamento inventado em 'exatamente'", () => {
        const out = sanitizePreparePaymentAgainstUserText(base, "exatament", null);
        assert.equal(out.paymentMethod, null);
        assert.equal(out.changeFor, null);
    });

    it("mantém pix se o cliente disse pix", () => {
        const out = sanitizePreparePaymentAgainstUserText(
            { ...base, paymentMethod: "pix", changeFor: null },
            "pode ser no pix",
            null
        );
        assert.equal(out.paymentMethod, "pix");
        assert.equal(userTextMentionsPayment("pode ser no pix"), true);
    });

    it("preserva pagamento já no draft", () => {
        const out = sanitizePreparePaymentAgainstUserText(base, "exatament", {
            items: [],
            paymentMethod: "pix",
            changeFor: null,
        } as never);
        assert.equal(out.paymentMethod, "pix");
    });
});

describe("stripHallucinatedOrderPersistenceClaims", () => {
    it("mensagem amigável com draft completo", () => {
        const msg = stripHallucinatedOrderPersistenceClaims("Pedido confirmado! Número do pedido 123", {
            draftComplete: true,
        });
        assert.match(msg, /Confirmar/i);
        assert.doesNotMatch(msg, /rascunho validado/i);
    });
});
