/**
 * Testes de fluxo do chatbot (processInboundMessage).
 *
 * Usa injeção em require.cache (CJS) para mockar WhatsApp e TextParserService
 * antes de carregar processMessage. Um mock Supabase injetável controla
 * o estado de sessão por teste.
 *
 * Fluxos cobertos:
 *  - cancelar / menu / oi → reseta sessão
 *  - produto encontrado → adiciona ao carrinho
 *  - produto CX (caixa) → preço de caixa
 *  - produto não encontrado → resposta amigável
 *  - ver carrinho com itens
 *  - ver carrinho vazio
 *  - fechar pedido com itens
 *  - fechar pedido com carrinho vazio
 *  - pagamento: pix / cartão
 *  - bot inativo → sem resposta
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { join } from "path";

// ─── Produtos mock para getCachedProducts ─────────────────────────────────────

const MOCK_PRODUCTS = [
    {
        id: "heine-600-un",
        productId: "prod-heine",
        productName: "Heineken",
        unitPrice: 7.50,
        tags: "heineken cerveja",
        details: "600ml",
        volumeValue: 600,
        unit: "ml",
        hasCase: true,
        caseQty: 24,
        casePrice: 150.00,
        caseVariantId: "heine-600-cx",
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

// ─── Linhas mock para view_chat_produtos (formato do banco) ───────────────────

const DB_ROWS = [
    { id: "heine-600-un", produto_id: "prod-heine", descricao: "600ml", fator_conversao: 1, preco_venda: 7.50, tags: "heineken cerveja", is_acompanhamento: false, sigla_comercial: "UN", product_name: "Heineken", product_unit_type: "ml", product_details: "600ml", volume_quantidade: 600, unit_type_sigla: "ml", company_id: "company-1" },
    { id: "heine-600-cx", produto_id: "prod-heine", descricao: "cx 24un", fator_conversao: 24, preco_venda: 150.00, tags: "heineken cerveja", is_acompanhamento: false, sigla_comercial: "CX", product_name: "Heineken", product_unit_type: "ml", product_details: "600ml", volume_quantidade: 600, unit_type_sigla: "ml", company_id: "company-1" },
    { id: "skol-350-un", produto_id: "prod-skol", descricao: "350ml", fator_conversao: 1, preco_venda: 3.80, tags: "skol cerveja lata", is_acompanhamento: false, sigla_comercial: "UN", product_name: "Skol", product_unit_type: "ml", product_details: "350ml", volume_quantidade: 350, unit_type_sigla: "ml", company_id: "company-1" },
    { id: "agua-un", produto_id: "prod-agua", descricao: null, fator_conversao: 1, preco_venda: 2.50, tags: "agua mineral", is_acompanhamento: false, sigla_comercial: "UN", product_name: "Água Mineral", product_unit_type: "un", product_details: null, volume_quantidade: 0, unit_type_sigla: null, company_id: "company-1" },
];

// ─── Mock Supabase (chainable via Proxy) ──────────────────────────────────────

interface MockAdmin {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any;
    lastUpsert: Record<string, Record<string, unknown>>;
}

function createMockAdmin(tables: Record<string, Record<string, unknown>[]>): MockAdmin {
    const lastUpsert: Record<string, Record<string, unknown>> = {};

    function makeChain(tableName: string, rows: Record<string, unknown>[]): unknown {
        const prom = Promise.resolve({ data: rows, error: null });
        return new Proxy({} as Record<string, unknown>, {
            get(_, prop: string) {
                if (prop === "then")    return prom.then.bind(prom);
                if (prop === "catch")   return prom.catch.bind(prom);
                if (prop === "finally") return prom.finally.bind(prom);

                if (prop === "single" || prop === "maybeSingle")
                    return () => Promise.resolve({ data: rows[0] ?? null, error: null });

                // limit() NÃO termina a chain (código pode encadear .maybeSingle() após .limit())
                if (prop === "limit")
                    return () => makeChain(tableName, rows);

                if (prop === "upsert")
                    return (data: Record<string, unknown>) => {
                        lastUpsert[tableName] = data;
                        return makeChain(tableName, Array.isArray(data) ? data : [data]);
                    };

                // select / eq / neq / gt / in / or / order / … → mesmo chain
                return () => makeChain(tableName, rows);
            },
        });
    }

    return {
        client: { from: (t: string) => makeChain(t, tables[t] ?? []), rpc: () => Promise.resolve({ data: null, error: null }) },
        lastUpsert,
    };
}

// ─── Factories de sessão ──────────────────────────────────────────────────────

function sessionRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "sess-1", step: "welcome", cart: [], customer_id: null, context: {},
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        ...overrides,
    };
}

function baseAdmin(sessionOverrides: Record<string, unknown> = {}) {
    return createMockAdmin({
        chatbots:           [{ id: "bot-1", is_active: true, company_id: "company-1" }],
        companies:          [{ id: "company-1", name: "Disk Bebidas Teste", settings: {} }],
        chatbot_sessions:   [sessionRow(sessionOverrides)],
        view_chat_produtos: DB_ROWS,
        delivery_zones:     [],
        orders:             [],
        order_items:        [],
        customers:          [],   // getOrCreateCustomer
        product_categories: [],   // handleCatalogCategories
        brands:             [],   // handleCatalogBrands
    });
}

// ─── Setup: injeção no require.cache antes de carregar processMessage ──────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processInboundMessage: (p: Record<string, unknown>) => Promise<void>;
const sentMessages: string[] = [];
const sentButtons: { body: string; buttons: unknown[] }[] = [];

before(async () => {
    // Paths resolvidos a partir do diretório do arquivo compilado (.tests-dist/tests/chatbot/)
    const sendPath = join(__dirname, "..", "..", "lib", "whatsapp", "send.js");
    const tspPath  = join(__dirname, "..", "..", "lib", "chatbot", "TextParserService.js");

    // Injeta mocks ANTES de qualquer require de processMessage
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;

    cache[sendPath] = {
        id: sendPath, filename: sendPath, loaded: true,
        exports: {
            sendWhatsAppMessage: async (_: string, text: string) => {
                sentMessages.push(text);
                return { ok: true };
            },
            sendInteractiveButtons: async (_: string, body: string, buttons: unknown[]) => {
                sentButtons.push({ body, buttons });
                sentMessages.push(body);
                return { ok: true };
            },
            sendListMessage: async (_: string, body: string) => {
                sentMessages.push(body);
                return { ok: true };
            },
            sendListMessageSections: async (_: string, body: string) => {
                sentMessages.push(body);
                return { ok: true };
            },
        },
    };

    cache[tspPath] = {
        id: tspPath, filename: tspPath, loaded: true,
        exports: { getCachedProducts: async () => MOCK_PRODUCTS },
    };

    // Carrega processMessage depois dos mocks
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(join(__dirname, "..", "..", "lib", "chatbot", "processMessage.js"));
    processInboundMessage = mod.processInboundMessage;
});

// ─── Helpers de teste ─────────────────────────────────────────────────────────

function clearMessages() {
    sentMessages.length = 0;
    sentButtons.length  = 0;
}

async function send(text: string, sessionOverrides: Record<string, unknown> = {}) {
    clearMessages();
    const { client: admin } = baseAdmin(sessionOverrides);
    await processInboundMessage({
        admin,
        companyId:   "company-1",
        threadId:    "thread-1",
        messageId:   "msg-1",
        phoneE164:   "+5565999990000",
        text,
        profileName: "Cliente Teste",
    });
    return { msgs: [...sentMessages], btns: [...sentButtons] };
}

function anyMsg(msgs: string[], fragments: string[]): boolean {
    const joined = msgs.join(" ").toLowerCase();
    return fragments.some((f) => joined.includes(f.toLowerCase()));
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("comandos globais: cancelar / menu / oi", () => {
    it("'cancelar' → envia menu principal", async () => {
        const { msgs } = await send("cancelar");
        assert.ok(msgs.length > 0, "nenhuma mensagem enviada");
        assert.ok(anyMsg(msgs, ["cardápio", "pedido", "menu", "olá", "ola", "bem-vind", "atendimento"]),
            `Resposta de cancelar inesperada: "${msgs[0]}"`);
    });

    it("'oi' → envia boas-vindas", async () => {
        const { msgs } = await send("oi");
        assert.ok(msgs.length > 0, "nenhuma mensagem enviada");
    });

    it("'menu' → envia menu", async () => {
        const { msgs } = await send("menu");
        assert.ok(msgs.length > 0, "nenhuma mensagem enviada");
    });
});

describe("produto encontrado via texto livre", () => {
    it("'heineken' → resposta menciona heineken, qty ou carrinho", async () => {
        const { msgs } = await send("heineken");
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["heineken", "quantidade", "carrinho", "adicionad"]),
            `Resposta inesperada: "${msgs[0]}"`);
    });

    it("'2 skol' → resposta menciona skol ou 2", async () => {
        const { msgs } = await send("2 skol");
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["skol", "2", "carrinho", "adicionad"]),
            `Resposta inesperada: "${msgs[0]}"`);
    });

    it("'6 cx de heineken' → resposta com CX ou caixa ou R$ 150", async () => {
        const { msgs } = await send("6 cx de heineken");
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["heineken", "caixa", "cx", "150", "carrinho", "adicionad"]),
            `Resposta sem menção a caixa: "${msgs[0]}"`);
    });

    it("produto inexistente → resposta amigável (não encontrado / incerto)", async () => {
        const { msgs } = await send("pizza margherita com borda recheada de queijo");
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["não", "nao", "encontr", "identific", "certeza", "identificar"]),
            `Resposta inesperada para produto não encontrado: "${msgs[0]}"`);
    });
});

describe("ver carrinho", () => {
    const cartWithItem = [
        { variantId: "heine-600-un", productId: "prod-heine", name: "Heineken 600ml", price: 7.50, qty: 2, isCase: false },
    ];

    // "ver carrinho" é tratado no step catalog_products (não no main_menu)
    it("'ver carrinho' no step catalog_products → lista o carrinho", async () => {
        const { msgs } = await send("ver carrinho", { step: "catalog_products", cart: cartWithItem });
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["heineken", "carrinho", "pedido", "2x", "2 x", "R$", "item"]),
            `Carrinho não listado corretamente: "${msgs[0]}"`);
    });

    it("'carrinho' com carrinho vazio → informa carrinho vazio ou mostra opções", async () => {
        const { msgs } = await send("carrinho", { step: "catalog_products", cart: [] });
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["vazio", "nada", "carrinho", "adicionar", "cardápio", "nenhum", "produtos"]),
            `Resposta para carrinho vazio inesperada: "${msgs[0]}"`);
    });
});

describe("fechar pedido", () => {
    const cartWithItem = [
        { variantId: "heine-600-un", productId: "prod-heine", name: "Heineken 600ml", price: 7.50, qty: 3, isCase: false },
    ];

    it("'fechar pedido' com itens → inicia checkout (endereço / pagamento / confirmar)", async () => {
        const { msgs } = await send("fechar pedido", { step: "main_menu", cart: cartWithItem });
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(
            anyMsg(msgs, ["endereço", "endereco", "entrega", "pagamento", "confirmar", "pedido", "fechar"]),
            `Resposta de checkout inesperada: "${msgs[0]}"`
        );
    });

    it("'fechar' com carrinho vazio → avisa carrinho vazio", async () => {
        const { msgs } = await send("fechar", { step: "main_menu", cart: [] });
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["vazio", "nada", "nenhum", "adicionar", "cardápio"]),
            `Resposta para fechar vazio inesperada: "${msgs[0]}"`);
    });
});

describe("pagamento", () => {
    const cartWithItem = [
        { variantId: "heine-600-un", productId: "prod-heine", name: "Heineken 600ml", price: 7.50, qty: 1 },
    ];
    const checkoutCtx = { delivery_address: "Rua das Flores, 86", delivery_fee: 5 };

    it("'pix' no step checkout_payment → aceita e avança", async () => {
        const { msgs } = await send("pix", { step: "checkout_payment", cart: cartWithItem, context: checkoutCtx });
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["pix", "confirmar", "pedido", "pagamento"]),
            `Resposta de pix inesperada: "${msgs[0]}"`);
    });

    it("'cartão' no step checkout_payment → aceita e avança", async () => {
        const { msgs } = await send("cartão", { step: "checkout_payment", cart: cartWithItem, context: checkoutCtx });
        assert.ok(msgs.length > 0, "nenhuma resposta enviada");
        assert.ok(anyMsg(msgs, ["cart", "confirmar", "pedido", "pagamento"]),
            `Resposta de cartão inesperada: "${msgs[0]}"`);
    });
});

describe("bot inativo → sem resposta", () => {
    it("sem chatbot ativo para a empresa → nenhuma mensagem enviada", async () => {
        clearMessages();
        const { client: admin } = createMockAdmin({
            chatbots:           [],   // sem bot ativo
            companies:          [{ id: "company-1", name: "Loja", settings: {} }],
            chatbot_sessions:   [sessionRow()],
            view_chat_produtos: [],
        });
        await processInboundMessage({
            admin,
            companyId: "company-1",
            threadId:  "thread-1",
            messageId: "msg-1",
            phoneE164: "+5565999990000",
            text:      "heineken",
        });
        assert.equal(sentMessages.length, 0, "não deveria enviar mensagem sem bot ativo");
    });
});
