import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_AUTO_PRINT_COPIES,
    filterCopiesForFulfillment,
    normalizePrintCopyTypes,
    printCopyBanner,
    printCopyLabel,
} from "../../lib/print/copyTypes";

describe("print copy types (M4)", () => {
    it("normaliza e deduplica", () => {
        assert.deepEqual(normalizePrintCopyTypes(["Kitchen", "cashier", "kitchen", "x"]), [
            "kitchen",
            "cashier",
        ]);
        assert.deepEqual(normalizePrintCopyTypes(null), []);
        assert.deepEqual(DEFAULT_AUTO_PRINT_COPIES, ["kitchen", "cashier", "driver"]);
    });

    it("via cliente (driver) permanece em pickup e delivery", () => {
        assert.deepEqual(
            filterCopiesForFulfillment(["kitchen", "cashier", "driver"], "pickup"),
            ["kitchen", "cashier", "driver"]
        );
        assert.deepEqual(
            filterCopiesForFulfillment(["kitchen", "driver"], "delivery"),
            ["kitchen", "driver"]
        );
    });

    it("labels PT-BR", () => {
        assert.equal(printCopyLabel("kitchen"), "Cozinha");
        assert.equal(printCopyLabel("cashier"), "Caixa");
        assert.equal(printCopyLabel("driver"), "Cliente");
        assert.equal(printCopyBanner("kitchen"), "VIA COZINHA");
        assert.equal(printCopyBanner("cashier"), "VIA CAIXA");
        assert.equal(printCopyBanner("driver"), "VIA CLIENTE");
    });
});
