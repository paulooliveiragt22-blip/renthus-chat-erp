import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    WA_ME_ORDERS_PREFILL,
    buildWaMeOrdersUrl,
    isWaMeOrdersPrefill,
} from "@/lib/public-menu/waMeIdentity";

describe("waMeIdentity", () => {
    it("monta wa.me com texto pré-preenchido", () => {
        const url = buildWaMeOrdersUrl("+5511999887766");
        assert.ok(url);
        assert.ok(url.startsWith("https://wa.me/5511999887766"));
        assert.ok(url.includes(encodeURIComponent(WA_ME_ORDERS_PREFILL)));
    });

    it("detecta inbound do fallback", () => {
        assert.equal(isWaMeOrdersPrefill("Ver meus pedidos"), true);
        assert.equal(isWaMeOrdersPrefill("  ver   meus   pedidos  "), true);
        assert.equal(isWaMeOrdersPrefill("quero ver cardapio"), false);
    });
});
