/**
 * tests/integration/webhook-integration.test.ts
 *
 * Suíte de testes de integração do chatbot via Webhook da Meta.
 *
 * ─── Estratégia ────────────────────────────────────────────────────────────────
 *  • NÃO usa API real da Meta (poupa as 250 conversas gratuitas)
 *  • NÃO usa API real do Supabase (banco isolado em memória via MockAdmin)
 *  • NÃO usa API real da Anthropic (ParserFactory mockado como low_confidence)
 *  • Injeta mocks via require.cache (CJS) antes de carregar processMessage
 *  • Chama processInboundMessage diretamente — mesmo padrão dos testes unitários
 *
 * ─── Cobertura ─────────────────────────────────────────────────────────────────
 *  Bloco 1: Extração do payload Meta (bodyText text/button/list)
 *  Bloco 2: Fluxo Feliz (boas-vindas, menu, produto)
 *  Bloco 3: Cenário de Erro (vazio, bot inativo, dados incompletos)
 *  Bloco 4: Cenário de Banco (chatbot_sessions gravado, step correto)
 *  Bloco 5: Botões interativos (mais_produtos, ver_carrinho, finalizar)
 *
 * ─── Execução ──────────────────────────────────────────────────────────────────
 *  npm run test:bot
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { join }                  from "path";

// ─── Fixtures e mocks importados ──────────────────────────────────────────────

import {
    textMessagePayload,
    buttonClickPayload,
    listReplyPayload,
    legacyButtonPayload,
    emptyMessagesPayload,
    wrongObjectPayload,
    statusCallbackPayload,
    extractBodyText,
    extractContact,
} from "./mocks/meta-webhook.mock";

import {
    createMockAdmin,
    baseAdmin,
    sessionRow,
    MOCK_DB_ROWS,
} from "./mocks/supabase.mock";

// ─── Produtos mock para TextParserService ─────────────────────────────────────

const MOCK_PRODUCTS = [
    {
        id: "heine-600-un", productId: "prod-heine",
        productName: "Heineken", unitPrice: 7.50,
        tags: "heineken cerveja gelada", details: "600ml",
        volumeValue: 600, unit: "ml",
        hasCase: true, caseQty: 24, casePrice: 150.00, caseVariantId: "heine-600-cx",
    },
    {
        id: "skol-350-un", productId: "prod-skol",
        productName: "Skol", unitPrice: 3.80,
        tags: "skol cerveja lata", details: "350ml",
        volumeValue: 350, unit: "ml", hasCase: false,
    },
    {
        id: "agua-500-un", productId: "prod-agua",
        productName: "Água Mineral", unitPrice: 2.50,
        tags: "agua mineral", details: "500ml",
        volumeValue: 500, unit: "ml", hasCase: false,
    },
];

// ─── Estado compartilhado dos mocks de envio ──────────────────────────────────

const sentMessages: string[] = [];
const sentButtons:  { body: string; buttons: unknown[] }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processInboundMessage: (p: Record<string, unknown>) => Promise<void>;

// ─── Setup: injeta mocks no require.cache ANTES de carregar processMessage ─────

before(async () => {
    // Paths dos módulos compilados (relativo a .tests-dist/tests/integration/)
    const root = join(__dirname, "..", "..");

    const sendPath         = join(root, "lib", "whatsapp", "send.js");
    const sendMessagePath  = join(root, "lib", "whatsapp", "sendMessage.js");
    const tspPath       = join(root, "lib", "chatbot", "TextParserService.js");
    const parserPath    = join(root, "lib", "chatbot", "parsers", "ParserFactory.js");
    const processMsgPath = join(root, "lib", "chatbot", "processMessage.js");

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;

    // ── Mock 1: WhatsApp Send (evita chamadas reais à Meta Cloud API) ──────────
    cache[sendPath] = {
        id: sendPath, filename: sendPath, loaded: true,
        exports: {
            sendWhatsAppMessage: async (_phone: string, text: string) => {
                sentMessages.push(text);
                return { ok: true };
            },
            sendInteractiveButtons: async (
                _phone: string, body: string, buttons: unknown[],
            ) => {
                sentButtons.push({ body, buttons });
                const titles = (buttons as { title?: string }[])
                    .map((b) => b.title ?? "")
                    .join(" ");
                sentMessages.push([body, titles].filter(Boolean).join("\n"));
                return { ok: true };
            },
            sendListMessage: async (_phone: string, body: string) => {
                sentMessages.push(body);
                return { ok: true };
            },
            sendListMessageSections: async (_phone: string, body: string) => {
                sentMessages.push(body);
                return { ok: true };
            },
            sendFlowMessage: async (_phone: string, payload: { bodyText?: string }) => {
                if (payload?.bodyText) sentMessages.push(payload.bodyText);
                return { ok: true };
            },
        },
    };

    // ── Mock 1b: sendMessage (botReply / painel — não chama Meta nem lê canais) ─
    cache[sendMessagePath] = {
        id: sendMessagePath, filename: sendMessagePath, loaded: true,
        exports: {
            sendWhatsAppMessage: async (p: { text?: string }) => {
                if (p.text) sentMessages.push(p.text);
                return { ok: true };
            },
        },
    };

    // ── Mock 2: TextParserService (evita query ao Supabase para catálogo) ──────
    cache[tspPath] = {
        id: tspPath, filename: tspPath, loaded: true,
        exports: { getCachedProducts: async () => MOCK_PRODUCTS },
    };

    // ── Mock 3: ParserFactory (evita chamadas reais à Anthropic API) ───────────
    // Retorna low_confidence para qualquer input — os testes usam inputs que são
    // interceptados pelos checks globais (step, regex) antes de precisar de IA.
    cache[parserPath] = {
        id: parserPath, filename: parserPath, loaded: true,
        exports: {
            parseWithFactory: async (_opts: unknown) => ({
                action:        "low_confidence",
                items:         [],
                contextUpdate: {},
                confidence:    0.1,
            }),
            parseWithRegex: async (_input: string, _products: unknown[]) => ({
                action: "low_confidence",
                items:  [],
            }),
        },
    };

    // ── Carrega processMessage DEPOIS dos mocks (require.cache já populado) ────
    // Apaga cache anterior para garantir que os novos mocks sejam usados
    delete cache[join(root, "lib", "chatbot", "botSend.js")];
    delete cache[sendMessagePath];
    delete cache[processMsgPath];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(processMsgPath);
    processInboundMessage = mod.processInboundMessage;
});

// ─── Helpers de teste ─────────────────────────────────────────────────────────

function clearMessages(): void {
    sentMessages.length = 0;
    sentButtons.length  = 0;
}

/** Envia uma mensagem através do processInboundMessage com mock Supabase */
async function send(
    text:             string,
    sessionOverrides: Record<string, unknown> = {},
) {
    clearMessages();
    const mock = baseAdmin(sessionOverrides);

    await processInboundMessage({
        admin:       mock.client,
        companyId:   "company-1",
        threadId:    "thread-1",
        messageId:   `msg-test-${Date.now()}`,
        phoneE164:   "+5565999990000",
        text,
        profileName: "Cliente Teste",
        waConfig:    { phoneNumberId: "test-phone-id", accessToken: "test-token" },
    });

    return {
        msgs:   [...sentMessages],
        btns:   [...sentButtons],
        writes: mock.writes,
        mock,
    };
}

/** Verifica se ALGUM dos msgs/btns contém os fragmentos (case-insensitive) */
function anyMsg(msgs: string[], fragments: string[]): boolean {
    const joined = msgs.join(" ").toLowerCase();
    return fragments.some((f) => joined.includes(f.toLowerCase()));
}

/** Serializa todos os writes de uma tabela para depuração */
function writeSummary(
    writes: ReturnType<typeof baseAdmin>["writes"],
    table: string,
): string {
    return JSON.stringify(writes.filter((w) => w.table === table), null, 2);
}

// ═════════════════════════════════════════════════════════════════════════════
// BLOCO 1 — Extração do payload da Meta (zero side-effects, testes puros)
// ═════════════════════════════════════════════════════════════════════════════

describe("1. Payload Meta — extração de bodyText", () => {

    it("extrai texto de mensagem simples (type=text)", () => {
        const payload = textMessagePayload("Quero fazer um pedido");
        assert.strictEqual(extractBodyText(payload), "Quero fazer um pedido");
    });

    it("extrai ID de button_reply ao clicar em botão interativo", () => {
        const payload = buttonClickPayload("mais_produtos", "Mais produtos");
        assert.strictEqual(extractBodyText(payload), "mais_produtos");
        // O ID é preferido ao título (rota usa id ?? title)
    });

    it("extrai título de button_reply quando ID é igual ao título", () => {
        const payload = buttonClickPayload("1", "Ver cardápio");
        assert.strictEqual(extractBodyText(payload), "1");
    });

    it("extrai ID de list_reply ao selecionar item de lista", () => {
        const payload = listReplyPayload("cat-cervejas-idx-2", "Cervejas");
        assert.strictEqual(extractBodyText(payload), "cat-cervejas-idx-2");
    });

    it("extrai texto de mensagem type=button (template legado)", () => {
        const payload = legacyButtonPayload("Ver cardápio");
        assert.strictEqual(extractBodyText(payload), "Ver cardápio");
    });

    it("retorna string vazia quando não há mensagens no payload", () => {
        assert.strictEqual(extractBodyText(emptyMessagesPayload), "");
    });

    it("payload com object errado NÃO é whatsapp_business_account", () => {
        assert.notStrictEqual(wrongObjectPayload.object, "whatsapp_business_account");
    });

    it("status callback não possui messages (não deve processar chatbot)", () => {
        const msgs = statusCallbackPayload.entry[0].changes[0].value.messages;
        assert.strictEqual(msgs.length, 0);
    });

    it("extrai phoneE164 com prefixo '+' do contato", () => {
        const payload = textMessagePayload("oi", { phone: "5565999990000" });
        const { phoneE164 } = extractContact(payload);
        assert.match(phoneE164, /^\+\d+$/, "phoneE164 deve começar com '+'");
    });

    it("preserva profileName no payload", () => {
        const payload = textMessagePayload("oi", { profileName: "João Silva" });
        const { profileName } = extractContact(payload);
        assert.strictEqual(profileName, "João Silva");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// BLOCO 2 — Fluxo Feliz
// ═════════════════════════════════════════════════════════════════════════════

// Depende do catálogo por texto/steps removidos do `inboundPipeline` (Flow-first).
describe.skip("2. Fluxo Feliz — boas-vindas e navegação", () => {

    it("'oi' → reset global → bot responde com menu interativo", async () => {
        const { msgs, btns } = await send("oi");
        // "oi" é interceptado pelo global reset (processMessage linha 145)
        assert.ok(
            btns.length > 0 || msgs.length > 0,
            "Bot deve responder com menu após 'oi'",
        );
    });

    it("'menu' → bot exibe opções do menu principal", async () => {
        const { btns, msgs } = await send("menu", { step: "checkout_confirm" });
        assert.ok(
            btns.length > 0 || anyMsg(msgs, ["cardápio", "pedido", "atendente", "ajudar"]),
            `Bot deve exibir menu. msgs: ${msgs.join("|")}`,
        );
    });

    it("'reiniciar' → sessão resetada para main_menu e carrinho esvaziado", async () => {
        const { writes } = await send("reiniciar", {
            step: "checkout_payment",
            cart: [{ variantId: "v1", name: "Heineken", price: 7.5, qty: 1 }],
        });
        const sessWrites = writes.filter((w) => w.table === "chatbot_sessions");
        assert.ok(sessWrites.length > 0, "Deve gravar em chatbot_sessions");

        const hasReset = sessWrites.some((w) => {
            const d = w.data as Record<string, unknown>;
            return d?.step === "main_menu" ||
                   JSON.stringify(w.data).includes("main_menu");
        });
        assert.ok(hasReset, `Sessão deve voltar para main_menu. writes: ${writeSummary(writes, "chatbot_sessions")}`);
    });

    it("step welcome + texto longo → handleMainMenu → bot responde", async () => {
        const { msgs, btns } = await send("boa tarde", { step: "welcome" });
        // "boa tarde" pode ser saudação → resposta no welcome step
        assert.ok(
            btns.length > 0 || msgs.length > 0,
            "Bot deve responder no step welcome",
        );
    });

    it("opção '1' (Ver cardápio) no main_menu → envia lista de categorias", async () => {
        const { msgs } = await send("1", { step: "main_menu" });
        assert.ok(
            anyMsg(msgs, ["categoria", "cervejas", "escolha", "cardápio"]),
            `Opção 1 deve mostrar categorias. msgs: ${msgs.join("|")}`,
        );
    });

    it("opção '2' (Status do pedido) → responde sobre último pedido", async () => {
        const { msgs } = await send("2", { step: "main_menu" });
        assert.ok(
            anyMsg(msgs, ["pedido", "nenhum", "ainda", "cardápio", "faça", "status"]),
            `Opção 2 deve responder sobre pedidos. msgs: ${msgs.join("|")}`,
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// BLOCO 3 — Cenário de Erro
// ═════════════════════════════════════════════════════════════════════════════

describe("3. Cenário de Erro — entradas inválidas e edge cases", () => {

    it("texto vazio (só espaços) → sem resposta (NÃO deve crashar)", async () => {
        const { msgs, btns } = await send("   ");
        assert.strictEqual(msgs.length, 0, "Texto em branco não deve gerar resposta");
        assert.strictEqual(btns.length, 0, "Texto em branco não deve gerar botões");
    });

    it("bot inativo para empresa → sem resposta enviada", async () => {
        clearMessages();
        const mock = createMockAdmin({
            chatbots:           [], // ← nenhum chatbot ativo
            companies:          [{ id: "company-1", name: "Test", settings: {} }],
            chatbot_sessions:   [sessionRow()],
            view_chat_produtos: MOCK_DB_ROWS,
            view_categories:    [],
        });

        await processInboundMessage({
            admin:       mock.client,
            companyId:   "company-1",
            threadId:    "thread-1",
            messageId:   "msg-bot-inactive",
            phoneE164:   "+5565999990000",
            text:        "quero pedir uma heineken",
            profileName: null,
        });

        assert.strictEqual(
            sentMessages.length, 0,
            "Bot inativo não deve enviar nenhuma resposta",
        );
    });
});

describe.skip("3b. Cenário de Erro — fluxo legado (cancelar / catalog_products)", () => {

    it("'cancelar' sem carrinho → pede confirmação de cancelamento", async () => {
        const { msgs } = await send("cancelar", { step: "main_menu", cart: [] });
        assert.ok(
            anyMsg(msgs, ["cancelar", "certeza", "sim", "não", "confirmar"]),
            `Deve perguntar confirmação. msgs: ${msgs.join("|")}`,
        );
    });

    it("cancelar confirmado ('sim') → sessão volta para main_menu", async () => {
        const { writes } = await send("sim", {
            step:    "awaiting_cancel_confirm",
            cart:    [{ variantId: "v1", name: "Heineken", price: 7.5, qty: 1 }],
            context: { pre_cancel_step: "catalog_products" },
        });
        const hasCancelled = writes.some((w) =>
            w.table === "chatbot_sessions" &&
            JSON.stringify(w.data).includes("main_menu"),
        );
        assert.ok(hasCancelled, `Sessão deve ir para main_menu. writes: ${writeSummary(writes, "chatbot_sessions")}`);
    });

    it("'finalizar' com carrinho vazio → não avança (requer items)", async () => {
        const { msgs } = await send("finalizar", {
            step: "catalog_products",
            cart: [],
        });
        // handleCatalogProducts line 305: "Seu carrinho está vazio."
        // OU global CHECKOUT_KEYWORDS falha pois cart.length === 0
        assert.ok(
            msgs.length === 0 || anyMsg(msgs, ["vazio", "produto", "escolha", "item"]),
            `Sem itens, não deve avançar. msgs: ${msgs.join("|")}`,
        );
    });

    it("'atendente' → handover para humano", async () => {
        const { msgs } = await send("atendente", { step: "catalog_products" });
        assert.ok(
            anyMsg(msgs, ["atendente", "aguarde", "conectar", "humano", "responderá"]),
            `Deve confirmar handover. msgs: ${msgs.join("|")}`,
        );
    });

    it("input desconhecido no step principal → fallback com menu", async () => {
        const { msgs, btns } = await send("asdflkjqwert", { step: "main_menu" });
        // Após ParserFactory retornar low_confidence → handleLowConfidenceFallback
        assert.ok(
            btns.length > 0 || msgs.length > 0,
            "Input desconhecido deve gerar alguma resposta de fallback",
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// BLOCO 4 — Cenário de Banco (verificação de escritas no Supabase mock)
// ═════════════════════════════════════════════════════════════════════════════

describe.skip("4. Cenário de Banco — gravação correta no Supabase", () => {

    it("qualquer mensagem → chatbot_sessions deve ser gravado", async () => {
        const { writes } = await send("oi");
        const sessWrites = writes.filter((w) => w.table === "chatbot_sessions");
        assert.ok(
            sessWrites.length > 0,
            `chatbot_sessions deve ter ao menos um write. Writes totais: ${JSON.stringify(writes.map(w => w.table))}`,
        );
    });

    it("sessão gravada contém thread_id correto", async () => {
        const { mock } = await send("oi");
        const sessData = mock.sessionData();
        if (sessData) {
            assert.ok(
                !sessData.thread_id || sessData.thread_id === "thread-1",
                `thread_id deve ser 'thread-1'. Recebido: ${sessData.thread_id}`,
            );
        }
        // Se sessData é undefined o bot pode não ter gravado (session já existia)
        // O importante é que não houve erro
    });

    it("'menu' no step checkout → step gravado volta para main_menu", async () => {
        const { writes } = await send("menu", { step: "checkout_confirm" });
        const sessWrites = writes.filter((w) => w.table === "chatbot_sessions");
        assert.ok(sessWrites.length > 0, "Deve gravar em chatbot_sessions");

        const hasMainMenu = sessWrites.some((w) =>
            JSON.stringify(w.data).includes("main_menu"),
        );
        assert.ok(hasMainMenu, `Step deve ser main_menu. writes: ${writeSummary(writes, "chatbot_sessions")}`);
    });

    it("cancelar confirmado → cart gravado como array vazio", async () => {
        const { writes } = await send("sim", {
            step:    "awaiting_cancel_confirm",
            cart:    [{ variantId: "v1", name: "Heineken", price: 7.5, qty: 2 }],
            context: {},
        });
        const sessWrites = writes.filter((w) => w.table === "chatbot_sessions");
        const hasClearedCart = sessWrites.some((w) => {
            const raw = JSON.stringify(w.data);
            return raw.includes('"cart":[]') || raw.includes('"cart": []');
        });
        assert.ok(
            hasClearedCart,
            `Cancelamento deve limpar cart. writes: ${writeSummary(writes, "chatbot_sessions")}`,
        );
    });

    it("opção '1' (cardápio) → step gravado como catalog_categories", async () => {
        const { writes } = await send("1", { step: "main_menu" });
        const sessWrites = writes.filter((w) => w.table === "chatbot_sessions");
        const hasCatStep = sessWrites.some((w) =>
            JSON.stringify(w.data).includes("catalog_categories"),
        );
        assert.ok(
            hasCatStep,
            `Opção 1 deve gravar step catalog_categories. writes: ${writeSummary(writes, "chatbot_sessions")}`,
        );
    });

    it("cancelar 'não' → step volta ao step anterior", async () => {
        const { writes } = await send("não", {
            step:    "awaiting_cancel_confirm",
            context: { pre_cancel_step: "catalog_products" },
        });
        const sessWrites = writes.filter((w) => w.table === "chatbot_sessions");
        assert.ok(sessWrites.length > 0, "Deve gravar a volta ao step anterior");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// BLOCO 5 — Botões interativos (mais_produtos, ver_carrinho, finalizar)
// ═════════════════════════════════════════════════════════════════════════════

describe.skip("5. Botões interativos — catálogo e navegação", () => {

    it("'mais_produtos' → exibe lista de categorias (sem travar por awaiting_neighborhood)", async () => {
        const { msgs } = await send("mais_produtos", {
            step:    "catalog_products",
            context: { awaiting_neighborhood: true }, // flag que causava o bug
        });
        assert.ok(
            anyMsg(msgs, ["categoria", "cervejas", "escolha", "cardápio"]),
            `mais_produtos deve mostrar categorias mesmo com awaiting_neighborhood=true. msgs: ${msgs.join("|")}`,
        );
    });

    it("'mais_produtos' → step gravado como catalog_categories", async () => {
        const { writes } = await send("mais_produtos", { step: "catalog_products" });
        const hasCatStep = writes.some((w) =>
            w.table === "chatbot_sessions" &&
            JSON.stringify(w.data).includes("catalog_categories"),
        );
        assert.ok(hasCatStep, `mais_produtos deve gravar step catalog_categories. writes: ${writeSummary(writes, "chatbot_sessions")}`);
    });

    it("'ver_carrinho' com carrinho vazio → aviso de carrinho vazio", async () => {
        const { msgs } = await send("ver_carrinho", {
            step: "catalog_products",
            cart: [],
        });
        assert.ok(
            anyMsg(msgs, ["vazio", "carrinho", "sem", "nenhum", "item"]),
            `Carrinho vazio deve ser avisado. msgs: ${msgs.join("|")}`,
        );
    });

    it("'ver_carrinho' com itens → exibe resumo com produtos e preço", async () => {
        const { msgs } = await send("ver_carrinho", {
            step: "catalog_products",
            cart: [
                { variantId: "heine-600-un", name: "Heineken 600ml", price: 7.50, qty: 2 },
            ],
        });
        assert.ok(
            anyMsg(msgs, ["heineken", "carrinho", "pedido", "2", "7", "15"]),
            `Carrinho com itens deve mostrar resumo. msgs: ${msgs.join("|")}`,
        );
    });

    it("'ver_carrinho' NÃO é interceptado por awaiting_neighborhood (bug fix)", async () => {
        // Este teste garante que o fix em handleCatalog.ts funciona corretamente
        const { msgs } = await send("ver_carrinho", {
            step:    "catalog_products",
            cart:    [{ variantId: "v1", name: "Heineken", price: 7.5, qty: 1 }],
            context: { awaiting_neighborhood: true, delivery_address: "Rua Teste 123" },
        });
        // Não deve mostrar "Não atendemos *ver_carrinho*" — deve ir ao carrinho
        assert.ok(
            !anyMsg(msgs, ["não atendemos", "bairros de entrega"]),
            `ver_carrinho não deve ser tratado como nome de bairro. msgs: ${msgs.join("|")}`,
        );
        assert.ok(
            anyMsg(msgs, ["carrinho", "heineken", "pedido", "vazio"]),
            `Deve mostrar o carrinho. msgs: ${msgs.join("|")}`,
        );
    });

    it("'finalizar' com itens no carrinho → avança para checkout", async () => {
        const { writes, msgs } = await send("finalizar", {
            step: "catalog_products",
            cart: [{ variantId: "heine-600-un", name: "Heineken 600ml", price: 7.50, qty: 1 }],
        });
        // goToCheckoutFromCart → vai para checkout_address, checkout_payment ou awaiting_flow
        assert.ok(
            msgs.length > 0 || writes.length > 0,
            "'finalizar' deve avançar o pedido para checkout",
        );
        const hasCheckout = writes.some((w) =>
            w.table === "chatbot_sessions" &&
            JSON.stringify(w.data).match(/checkout|awaiting_flow/),
        );
        assert.ok(
            hasCheckout,
            `Step deve ser de checkout. writes: ${writeSummary(writes, "chatbot_sessions")}`,
        );
    });

    it("'mais_produtos' limpa pending_variant e awaiting_neighborhood do contexto", async () => {
        const { writes } = await send("mais_produtos", {
            step:    "catalog_products",
            context: {
                pending_variant:       { id: "heine-600-un" },
                awaiting_neighborhood: true,
            },
        });
        const sessWrite = writes.find((w) => w.table === "chatbot_sessions");
        if (sessWrite) {
            const raw = JSON.stringify(sessWrite.data);
            // awaiting_neighborhood deve ser false no contexto gravado
            assert.ok(
                raw.includes('"awaiting_neighborhood":false') ||
                !raw.includes('"awaiting_neighborhood":true'),
                `awaiting_neighborhood deve ser false. write: ${raw}`,
            );
        }
    });

    it("clique em botão (list_reply '1') na seleção de categorias → exibe produtos", async () => {
        const { msgs } = await send("1", {
            step:    "catalog_categories",
            context: {
                categories: [
                    { id: "cat-cervejas", name: "Cervejas" },
                    { id: "cat-outros",   name: "Outros"   },
                ],
            },
        });
        assert.ok(msgs.length > 0, `Seleção de categoria deve exibir resposta. msgs: ${msgs.join("|")}`);
    });
});
