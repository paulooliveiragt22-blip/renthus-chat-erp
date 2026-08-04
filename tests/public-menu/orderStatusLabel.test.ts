import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    publicMenuOrderCode,
    publicMenuOrderStatusLabel,
    publicMenuPaymentLabel,
} from "../../lib/public-menu/checkout/orderStatusLabel";

describe("public-menu order status labels", () => {
    it("mapeia status principais", () => {
        assert.equal(publicMenuOrderStatusLabel("new", "pending_confirmation"), "Aguardando confirmação");
        assert.equal(publicMenuOrderStatusLabel("delivered", "confirmed"), "Em entrega");
        assert.equal(publicMenuOrderStatusLabel("finalized", "confirmed"), "Finalizado");
        assert.equal(publicMenuOrderStatusLabel("canceled", null), "Cancelado");
    });

    it("payment e código", () => {
        assert.equal(publicMenuPaymentLabel("pix"), "PIX");
        assert.equal(publicMenuOrderCode("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").length, 7);
        assert.ok(publicMenuOrderCode("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").startsWith("#"));
    });
});
