import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    looksLikeNonMoneyWhileAwaitingChange,
    parsePtMoneyInput,
} from "../../src/pro/pipeline/paymentFromUserText";
import { sanitizePreparePaymentAgainstUserText } from "../../src/pro/pipeline/sanitizePreparePayment";
import { stripHallucinatedOrderPersistenceClaims } from "../../src/pro/adapters/ai/sanitizeAiVisibleOrderClaims";
import { parseOrderLineExtractionJson } from "../../src/domain/contracts/orderExtraction";
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

describe("looksLikeNonMoneyWhileAwaitingChange", () => {
    it("libera FAQ e texto longo", () => {
        assert.equal(looksLikeNonMoneyWhileAwaitingChange("tem coca 2l?"), true);
        assert.equal(looksLikeNonMoneyWhileAwaitingChange("quero fechar o pedido agora"), true);
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

    it("remove pagamento inventado sem menção do cliente/draft", () => {
        const out = sanitizePreparePaymentAgainstUserText(base, "exatament", null);
        assert.equal(out.paymentMethod, null);
        assert.equal(out.changeFor, null);
    });

    it("aceita pix citado no texto do cliente", () => {
        const out = sanitizePreparePaymentAgainstUserText(
            { ...base, paymentMethod: "pix", changeFor: null },
            "quero fechar no pix",
            null
        );
        assert.equal(out.paymentMethod, "pix");
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

describe("parseOrderLineExtractionJson dialogue", () => {
    it("aceita dialogue sem items", () => {
        const parsed = parseOrderLineExtractionJson({
            v: 1,
            items: [],
            dialogue: { act: "add_more", quantity: 2 },
        });
        assert.ok(parsed);
        assert.equal(parsed?.dialogue?.act, "add_more");
        assert.equal(parsed?.dialogue?.quantity, 2);
    });
    it("aceita quantity_only", () => {
        const parsed = parseOrderLineExtractionJson({
            v: 1,
            items: [],
            dialogue: { act: "quantity_only", quantity: 3 },
        });
        assert.equal(parsed?.dialogue?.act, "quantity_only");
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
