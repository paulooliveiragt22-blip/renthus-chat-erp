/**
 * Testes de integração para OrderParserService.
 *
 * Usa produtos mock — sem Supabase, sem Google Maps.
 * Cobre: produto único, qty, embalagem (CX), multi-item, endereço,
 *        produto não encontrado, baixa confiança, bug do endereço (qty 86).
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { OrderParserService } from "../../lib/chatbot/OrderParserService";
import type { ProductForSearch } from "../../lib/chatbot/OrderParserService";

// ─── Dados mock ───────────────────────────────────────────────────────────────

const PRODUCTS: ProductForSearch[] = [
    {
        id: "heine-600-un",
        productId: "prod-heine",
        productName: "Heineken",
        unitPrice: 7.50,
        tags: "heineken cerveja long neck",
        details: "600ml",
        volumeValue: 600,
        unit: "ml",
        hasCase: true,
        caseQty: 24,
        casePrice: 150.00,
        caseVariantId: "heine-600-cx",
    },
    {
        id: "brahma-350-un",
        productId: "prod-brahma",
        productName: "Brahma",
        unitPrice: 4.00,
        tags: "brahma cerveja lata",
        details: "350ml",
        volumeValue: 350,
        unit: "ml",
        hasCase: true,
        caseQty: 12,
        casePrice: 40.00,
        caseVariantId: "brahma-350-cx",
    },
    {
        id: "skol-350-un",
        productId: "prod-skol",
        productName: "Skol",
        unitPrice: 3.80,
        tags: "skol cerveja lata",
        details: "350ml",
        volumeValue: 350,
        unit: "ml",
        hasCase: false,
    },
    {
        id: "agua-un",
        productId: "prod-agua",
        productName: "Água Mineral",
        unitPrice: 2.50,
        tags: "agua mineral",
    },
];

// ─── Setup ────────────────────────────────────────────────────────────────────

let parser: OrderParserService;

before(() => {
    // Sem chave de Google Maps → validateAddress retorna null/raw sem chamada HTTP
    parser = new OrderParserService();
});

function parse(text: string) {
    return parser.parseIntent(text, PRODUCTS, { validateAddressWithGoogle: false });
}

// ─── Produto único ────────────────────────────────────────────────────────────

describe("produto único — unidade", () => {
    it("'heineken' → add_to_cart, 1x UN", async () => {
        const r = await parse("heineken");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items.length, 1);
        assert.equal(r.items[0].qty, 1);
        assert.equal(r.items[0].packagingSigla, "UN");
        assert.equal(r.items[0].isCase, false);
        assert.equal(r.items[0].variantId, "heine-600-un");
        assert.equal(r.items[0].price, 7.50);
    });

    it("'2 brahma' → qty=2, UN, preço unitário", async () => {
        const r = await parse("2 brahma");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].qty, 2);
        assert.equal(r.items[0].packagingSigla, "UN");
        assert.equal(r.items[0].price, 4.00);
    });

    it("'agua mineral' → add_to_cart", async () => {
        const r = await parse("agua mineral");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items.length, 1);
        assert.ok(r.items[0].productId === "prod-agua");
    });
});

// ─── Embalagem (CX) ───────────────────────────────────────────────────────────

describe("embalagem CX", () => {
    it("'6 cx de heineken' → isCase=true, variantId=cx, preço=150", async () => {
        const r = await parse("6 cx de heineken");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].qty, 6);
        assert.equal(r.items[0].packagingSigla, "CX");
        assert.equal(r.items[0].isCase, true);
        assert.equal(r.items[0].variantId, "heine-600-cx");
        assert.equal(r.items[0].price, 150.00);
    });

    it("'2 caixinhas de brahma' → isCase=true, qty=2, preço=40 (alias regional)", async () => {
        const r = await parse("2 caixinhas de brahma");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].qty, 2);
        assert.equal(r.items[0].isCase, true);
        assert.equal(r.items[0].price, 40.00);
    });

    it("'1 fardinho heineken' → CX (fardinho = cx nesta região)", async () => {
        const r = await parse("1 fardinho heineken");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].packagingSigla, "CX");
        assert.equal(r.items[0].isCase, true);
    });

    it("'cx skol' sem casePrice → isCase=false (produto sem embalagem cadastrada)", async () => {
        // Skol não tem hasCase, então mesmo pedindo cx não vira isCase
        const r = await parse("cx skol");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].isCase, false);
    });
});

// ─── Multi-item ───────────────────────────────────────────────────────────────

describe("múltiplos produtos", () => {
    it("'2 brahma e 1 skol' → 2 itens", async () => {
        const r = await parse("2 brahma e 1 skol");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items.length, 2);
        const brahma = r.items.find((i) => i.productId === "prod-brahma");
        const skol   = r.items.find((i) => i.productId === "prod-skol");
        assert.ok(brahma, "brahma não encontrado");
        assert.ok(skol,   "skol não encontrado");
        assert.equal(brahma!.qty, 2);
        assert.equal(skol!.qty,   1);
    });

    it("'heineken + agua' → 2 itens (separador +)", async () => {
        const r = await parse("heineken + agua");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items.length, 2);
    });

    it("'brahma, skol' → 2 itens (separador vírgula)", async () => {
        const r = await parse("brahma, skol");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items.length, 2);
    });
});

// ─── Endereço ─────────────────────────────────────────────────────────────────

describe("extração de endereço", () => {
    it("'2 heineken na rua das flores 86' → produto + endereço → confirm_order, qty=2", async () => {
        const r = await parse("2 heineken na rua das flores 86");
        // produto + endereço na mesma mensagem → confirm_order
        assert.equal(r.action, "confirm_order");
        if (r.action !== "confirm_order") return;
        assert.equal(r.items.length, 1);
        assert.equal(r.items[0].qty, 2);
        const addr = r.address.formatted.toLowerCase();
        assert.ok(addr.includes("flores") || addr.includes("rua"), `endereço inesperado: ${addr}`);
    });

    it("BUG REGRESSÃO: '6 cx de heineken pra mim no beco sao bento 86' → qty=6 (não 86)", async () => {
        const r = await parse("6 cx de heineken pra mim no beco sao bento 86");
        // produto + endereço → confirm_order; qty deve ser 6, não 86
        assert.equal(r.action, "confirm_order");
        if (r.action !== "confirm_order") return;
        assert.equal(r.items.length, 1, "deve encontrar 1 produto");
        assert.equal(r.items[0].qty, 6, `qty deve ser 6, mas foi ${r.items[0].qty}`);
        assert.equal(r.items[0].packagingSigla, "CX");
        assert.equal(r.items[0].isCase, true);
    });

    it("'rua das flores 86' (só endereço, sem produto) → items=[], address set", async () => {
        const r = await parse("rua das flores 86");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items.length, 0);
        assert.ok(r.contextUpdate.delivery_address);
    });
});

// ─── Produto não encontrado / baixa confiança ─────────────────────────────────

describe("produto não encontrado", () => {
    it("'pizza margherita' → product_not_found ou low_confidence", async () => {
        const r = await parse("pizza margherita");
        assert.ok(
            r.action === "product_not_found" || r.action === "low_confidence",
            `ação inesperada: ${r.action}`
        );
    });

    it("string muito curta → invalid", async () => {
        const r = await parse("a");
        assert.equal(r.action, "invalid");
    });
});

// ─── Robustez ─────────────────────────────────────────────────────────────────

describe("robustez", () => {
    it("'heineken 600ml' → produto encontrado sem confundir 600 como qty", async () => {
        const r = await parse("heineken 600ml");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].qty, 1);
        assert.equal(r.items[0].productId, "prod-heine");
    });

    it("'quero 3 skol por favor' → qty=3 (verbo e cortesia removidos)", async () => {
        const r = await parse("quero 3 skol por favor");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].qty, 3);
    });

    it("'manda duas heineken' → qty=2 (palavra por extenso)", async () => {
        const r = await parse("manda duas heineken");
        assert.equal(r.action, "add_to_cart");
        if (r.action !== "add_to_cart") return;
        assert.equal(r.items[0].qty, 2);
    });
});
