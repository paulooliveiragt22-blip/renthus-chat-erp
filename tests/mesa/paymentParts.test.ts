import assert from "node:assert/strict";
import test from "node:test";
import {
    isMesaPaymentMethod,
    itemPartAmounts,
    lineQtysMatch,
    splitPreview,
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

test("divisão por item fecha a quantidade e reparte a taxa no subtotal", () => {
    const lines = [
        { id: "a", qty: 2, unitPrice: 10 },
        { id: "b", qty: 1, unitPrice: 5 },
    ];
    const payers = [
        { a: 1, b: 0 },
        { a: 1, b: 1 },
    ];
    assert.equal(lineQtysMatch(lines, payers), true);
    assert.equal(lineQtysMatch(lines, [{ a: 2, b: 0 }]), false);
    const amounts = itemPartAmounts(lines, payers, 2.5);
    assert.deepEqual(amounts, [11, 16.5]);
    assert.equal(Math.round(amounts.reduce((s, n) => s + n, 0) * 100) / 100, 27.5);
    const cents = itemPartAmounts(
        [{ id: "a", qty: 3, unitPrice: 10 }],
        [{ a: 1 }, { a: 1 }, { a: 1 }],
        1,
    );
    assert.deepEqual(cents, [10.33, 10.33, 10.34]);
});

test("pagador por valor e pagador por item fecham a mesma conta", () => {
    const lines = [
        { id: "a", qty: 2, unitPrice: 10 },
        { id: "b", qty: 1, unitPrice: 5 },
    ];
    const mixed = splitPreview(
        lines,
        [
            { basis: "item", amount: null, qty: { a: 1 } },
            { basis: "value", amount: 16.5, qty: {} },
        ],
        27.5,
        2.5,
    );
    assert.equal(mixed.qtyOk, true);
    assert.deepEqual(mixed.amounts, [11, 16.5]);
    assert.equal(mixed.remainder, 0);

    const short = splitPreview(
        lines,
        [{ basis: "item", amount: null, qty: { a: 1 } }],
        27.5,
        2.5,
    );
    assert.equal(short.qtyOk, false);

    const over = splitPreview(
        lines,
        [
            { basis: "item", amount: null, qty: { a: 3 } },
            { basis: "value", amount: 1, qty: {} },
        ],
        27.5,
        2.5,
    );
    assert.equal(over.qtyOk, false);
});
