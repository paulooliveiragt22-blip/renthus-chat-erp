import assert from "node:assert/strict";
import test from "node:test";
import {
    isMesaPaymentMethod,
    MESA_PAYMENT_METHODS,
    partsRemainder,
} from "../../src/mesa/domain/paymentParts";

test("formas da mesa são só as imediatas", () => {
    assert.deepEqual([...MESA_PAYMENT_METHODS], ["cash", "pix", "debit", "card"]);
    assert.equal(isMesaPaymentMethod("pix"), true);
    assert.equal(isMesaPaymentMethod("credit_installment"), false);
    assert.equal(isMesaPaymentMethod("boleto"), false);
});

test("restante da divisão é a conta menos a soma digitada", () => {
    assert.equal(partsRemainder(100, [40, 60]), 0);
    assert.equal(partsRemainder(100.1, [50, null]), 50.1);
    assert.equal(partsRemainder(10, [3.33, 3.33, 3.34]), 0);
});
