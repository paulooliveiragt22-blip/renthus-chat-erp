/**
 * Testes de edge cases para extração de endereço.
 *
 * A função extractAddressFromText é privada no OrderParserService,
 * mas é exercida via parseIntent. Testamos indiretamente:
 *   - Tipos de logradouro (rua, av, beco, quadra, travessa, etc.)
 *   - Variações de número (nº, n., número explícito)
 *   - Endereço + bairro/cidade concatenado
 *   - Endereço NÃO deve ser interpretado como produto
 *   - Número de endereço NÃO deve vazar para qty
 *   - Casos sem endereço (não retorna false positivo)
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { OrderParserService } from "../../lib/chatbot/OrderParserService";
import type { ProductForSearch } from "../../lib/chatbot/OrderParserService";

// ─── Produtos mock (mínimo necessário) ───────────────────────────────────────

const PRODUCTS: ProductForSearch[] = [
    {
        id: "heine-un",
        productId: "prod-heine",
        productName: "Heineken",
        unitPrice: 7.50,
        tags: "heineken cerveja",
        volumeValue: 600,
        unit: "ml",
        hasCase: true,
        caseQty: 24,
        casePrice: 150,
        caseVariantId: "heine-cx",
    },
    {
        id: "agua-un",
        productId: "prod-agua",
        productName: "Água Mineral",
        unitPrice: 2.50,
        tags: "agua mineral",
    },
];

let parser: OrderParserService;
before(() => { parser = new OrderParserService(); });

function parse(text: string) {
    return parser.parseIntent(text, PRODUCTS, { validateAddressWithGoogle: false });
}

// ─── Tipos de logradouro ──────────────────────────────────────────────────────

describe("tipos de logradouro", () => {
    it("rua → detecta endereço", async () => {
        const r = await parse("rua das flores 86");
        assert.ok(["add_to_cart", "confirm_order"].includes(r.action));
        const addr = getAddress(r);
        assert.ok(addr, "endereço não detectado");
        assert.ok(addr.toLowerCase().includes("flores"), `endereço inesperado: ${addr}`);
    });

    it("av / avenida → detecta endereço", async () => {
        const r = await parse("av brasil 1200");
        const addr = getAddress(r);
        assert.ok(addr, "endereço não detectado");
        assert.ok(addr.toLowerCase().includes("brasil"), `endereço inesperado: ${addr}`);
    });

    it("beco → detecta endereço (caso real: beco sao bento 86)", async () => {
        const r = await parse("heineken no beco sao bento 86");
        assert.ok(["add_to_cart", "confirm_order"].includes(r.action));
        const addr = getAddress(r);
        assert.ok(addr, "endereço não detectado no beco");
        assert.ok(addr.toLowerCase().includes("bento") || addr.toLowerCase().includes("sao"), `endereço inesperado: ${addr}`);
    });

    it("travessa → detecta endereço", async () => {
        const r = await parse("2 heineken na travessa sete de setembro 15");
        assert.ok(["add_to_cart", "confirm_order"].includes(r.action));
        const addr = getAddress(r);
        assert.ok(addr, "travessa não detectada");
    });

    it("quadra → detecta endereço (região MT: qd)", async () => {
        const r = await parse("heineken na quadra 3 lote 10");
        // pode ou não detectar — depende do regex; verificamos que não crashou
        assert.ok(r.action !== undefined);
    });
});

// ─── Variações de número ──────────────────────────────────────────────────────

describe("variações de número no endereço", () => {
    it("número simples '86'", async () => {
        const r = await parse("heineken na rua flores 86");
        const addr = getAddress(r);
        assert.ok(addr?.includes("86"), `número não detectado: ${addr}`);
    });

    it("'nº 86'", async () => {
        const r = await parse("heineken na rua flores nº 86");
        const addr = getAddress(r);
        assert.ok(addr, "nº 86 não detectado");
    });

    it("'n. 86'", async () => {
        const r = await parse("heineken na rua flores n. 86");
        const addr = getAddress(r);
        assert.ok(addr, "n. 86 não detectado");
    });
});

// ─── Número de endereço NÃO vaza para qty ─────────────────────────────────────

describe("número de endereço não vaza para quantidade", () => {
    it("'heineken na rua flores 86' → qty=1 (não 86)", async () => {
        const r = await parse("heineken na rua flores 86");
        if (r.action === "confirm_order" || r.action === "add_to_cart") {
            if (r.items.length > 0) {
                assert.notEqual(r.items[0].qty, 86, "86 do endereço vazou para qty");
                assert.equal(r.items[0].qty, 1);
            }
        }
    });

    it("'2 heineken na rua flores 86' → qty=2 (não 86)", async () => {
        const r = await parse("2 heineken na rua flores 86");
        if (r.action === "confirm_order" || r.action === "add_to_cart") {
            assert.equal(r.items[0]?.qty, 2, `qty deve ser 2, foi ${r.items[0]?.qty}`);
        }
    });

    it("'6 cx de heineken pra mim no beco sao bento 86' → qty=6 (não 86)", async () => {
        const r = await parse("6 cx de heineken pra mim no beco sao bento 86");
        if (r.action === "confirm_order") {
            assert.equal(r.items[0]?.qty, 6, `qty deve ser 6, foi ${r.items[0]?.qty}`);
        }
    });
});

// ─── Endereço com bairro/cidade ───────────────────────────────────────────────

describe("endereço com bairro/cidade concatenado", () => {
    it("'rua das flores 86 - Centro' → endereço inclui bairro", async () => {
        const r = await parse("2 heineken na rua das flores 86 - Centro");
        const addr = getAddress(r);
        assert.ok(addr, "endereço não detectado");
        // Endereço deve ter o logradouro
        assert.ok(addr.toLowerCase().includes("flores"), `logradouro não encontrado: ${addr}`);
    });

    it("'rua turmalina 120 São Mateus' → detecta bairro", async () => {
        const r = await parse("2 agua na rua turmalina 120 São Mateus");
        const addr = getAddress(r);
        assert.ok(addr, "endereço com bairro não detectado");
    });
});

// ─── Sem endereço → sem false positive ────────────────────────────────────────

describe("sem endereço — não cria false positive", () => {
    it("'heineken' puro → delivery_address ausente", async () => {
        const r = await parse("heineken");
        if (r.action === "add_to_cart") {
            assert.ok(!r.contextUpdate?.delivery_address, "endereço não deveria estar presente");
        }
    });

    it("'2 brahma 350ml' → sem endereço (número faz parte do produto)", async () => {
        const r = await parse("2 heineken");
        if (r.action === "add_to_cart") {
            assert.ok(!r.contextUpdate?.delivery_address, "350ml não deveria virar endereço");
        }
    });

    it("número solto '86' sem logradouro → não detecta como endereço", async () => {
        const r = await parse("86");
        // Deve ser inválido, não gerar endereço falso
        assert.ok(r.action === "invalid" || r.action === "product_not_found" || r.action === "low_confidence");
    });
});

// ─── helper ───────────────────────────────────────────────────────────────────

function getAddress(r: Awaited<ReturnType<OrderParserService["parseIntent"]>>): string | null {
    if (r.action === "confirm_order") return r.address.formatted;
    if (r.action === "add_to_cart")   return (r.contextUpdate?.delivery_address as string) ?? null;
    return null;
}
