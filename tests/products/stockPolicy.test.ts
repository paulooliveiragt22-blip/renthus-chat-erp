import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    canFulfillQty,
    disponivelVenda,
    shouldHideWhenOutOfStock,
} from "../../lib/products/stockPolicy";

describe("stockPolicy vender_com_estoque_zero", () => {
    it("default (true) permite vender com estoque 0", () => {
        assert.equal(
            canFulfillQty({
                venderComEstoqueZero: true,
                estoqueUnidades: 0,
                fatorConversao: 1,
                qty: 2,
            }),
            true
        );
        assert.equal(shouldHideWhenOutOfStock(true, 0), false);
    });

    it("false bloqueia venda e esconde quando zerado", () => {
        assert.equal(
            canFulfillQty({
                venderComEstoqueZero: false,
                estoqueUnidades: 0,
                fatorConversao: 1,
                qty: 1,
            }),
            false
        );
        assert.equal(shouldHideWhenOutOfStock(false, 0), true);
        assert.equal(shouldHideWhenOutOfStock(false, 5), false);
    });

    it("false ainda vende se houver estoque suficiente", () => {
        assert.equal(
            canFulfillQty({
                venderComEstoqueZero: false,
                estoqueUnidades: 12,
                fatorConversao: 6,
                qty: 2,
            }),
            true
        );
        assert.equal(
            canFulfillQty({
                venderComEstoqueZero: false,
                estoqueUnidades: 5,
                fatorConversao: 6,
                qty: 1,
            }),
            false
        );
    });

    it("disponivelVenda usa fator", () => {
        assert.equal(disponivelVenda(12, 6), 2);
        assert.equal(disponivelVenda(5, 6), 0);
    });
});
