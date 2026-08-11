import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrderIdempotencyKey } from "../../lib/orders/buildOrderIdempotencyKey";

describe("buildOrderIdempotencyKey", () => {
    it("mesmo conteúdo (retry/double-click) gera a mesma chave", () => {
        const base = {
            source: "web_menu",
            scopeId: "session-1",
            items: [
                { produtoEmbalagemId: "pe-1", quantity: 2, unitPrice: 10 },
                { produtoEmbalagemId: "pe-2", quantity: 1, unitPrice: 5 },
            ],
            grandTotal: 25,
            paymentMethod: "pix",
        };
        assert.equal(buildOrderIdempotencyKey(base), buildOrderIdempotencyKey(base));
    });

    it("ordem diferente dos itens não muda a chave (mesmo carrinho, ordem de envio diferente)", () => {
        const a = buildOrderIdempotencyKey({
            source: "web_menu",
            scopeId: "session-1",
            items: [
                { produtoEmbalagemId: "pe-1", quantity: 2, unitPrice: 10 },
                { produtoEmbalagemId: "pe-2", quantity: 1, unitPrice: 5 },
            ],
            grandTotal: 25,
            paymentMethod: "pix",
        });
        const b = buildOrderIdempotencyKey({
            source: "web_menu",
            scopeId: "session-1",
            items: [
                { produtoEmbalagemId: "pe-2", quantity: 1, unitPrice: 5 },
                { produtoEmbalagemId: "pe-1", quantity: 2, unitPrice: 10 },
            ],
            grandTotal: 25,
            paymentMethod: "pix",
        });
        assert.equal(a, b);
    });

    it("carrinho diferente (1 item muda qty) gera chave diferente", () => {
        const a = buildOrderIdempotencyKey({
            source: "web_menu",
            scopeId: "session-1",
            items: [{ produtoEmbalagemId: "pe-1", quantity: 2, unitPrice: 10 }],
            grandTotal: 20,
            paymentMethod: "pix",
        });
        const b = buildOrderIdempotencyKey({
            source: "web_menu",
            scopeId: "session-1",
            items: [{ produtoEmbalagemId: "pe-1", quantity: 3, unitPrice: 10 }],
            grandTotal: 30,
            paymentMethod: "pix",
        });
        assert.notEqual(a, b);
    });

    it("mesmo carrinho em escopos diferentes (sessão/thread) gera chaves diferentes", () => {
        const items = [{ produtoEmbalagemId: "pe-1", quantity: 1, unitPrice: 10 }];
        const a = buildOrderIdempotencyKey({
            source: "flow_catalog",
            scopeId: "thread-1",
            items,
            grandTotal: 10,
            paymentMethod: "pix",
        });
        const b = buildOrderIdempotencyKey({
            source: "flow_catalog",
            scopeId: "thread-2",
            items,
            grandTotal: 10,
            paymentMethod: "pix",
        });
        assert.notEqual(a, b);
    });

    it("mesmo carrinho em fontes diferentes (web_menu vs flow_catalog) gera chaves diferentes", () => {
        const items = [{ produtoEmbalagemId: "pe-1", quantity: 1, unitPrice: 10 }];
        const a = buildOrderIdempotencyKey({
            source: "web_menu",
            scopeId: "escopo-1",
            items,
            grandTotal: 10,
            paymentMethod: "pix",
        });
        const b = buildOrderIdempotencyKey({
            source: "flow_catalog",
            scopeId: "escopo-1",
            items,
            grandTotal: 10,
            paymentMethod: "pix",
        });
        assert.notEqual(a, b);
    });
});
