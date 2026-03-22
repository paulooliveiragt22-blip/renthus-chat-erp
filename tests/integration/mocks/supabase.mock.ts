/**
 * tests/integration/mocks/supabase.mock.ts
 *
 * MockAdmin para testes de integração do chatbot.
 *
 * Diferencial em relação ao mock nos unit tests:
 *  - Rastreia TODAS as escritas (insert/upsert/update/delete) por tabela
 *  - Permite asserções de banco ("chatbot_sessions foi atualizado?", "step é main_menu?")
 *  - Suporta cadeia completa de métodos Supabase via Proxy
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface WriteRecord {
    table:     string;
    operation: "insert" | "upsert" | "update" | "delete";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data:      any;
}

export interface MockAdmin {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any;
    writes: WriteRecord[];
    getLastWrite(table: string, op?: WriteRecord["operation"]): WriteRecord | undefined;
    getAllWrites(table: string): WriteRecord[];
    sessionData(): Record<string, unknown> | undefined;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMockAdmin(
    tables: Record<string, Record<string, unknown>[]>,
): MockAdmin {
    const writes: WriteRecord[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function makeChain(tableName: string, rows: Record<string, unknown>[]): any {
        const prom = Promise.resolve({ data: rows, error: null });

        return new Proxy({} as Record<string, unknown>, {
            get(_, prop: string) {
                // ── Thenable (para await direto da chain) ─────────────────────
                if (prop === "then")    return prom.then.bind(prom);
                if (prop === "catch")   return prom.catch.bind(prom);
                if (prop === "finally") return prom.finally.bind(prom);

                // ── Terminadores de chain ──────────────────────────────────────
                if (prop === "single" || prop === "maybeSingle") {
                    return () => Promise.resolve({ data: rows[0] ?? null, error: null });
                }

                // ── Escritas rastreadas ────────────────────────────────────────
                if (prop === "upsert") {
                    return (data: unknown, _opts?: unknown) => {
                        writes.push({ table: tableName, operation: "upsert", data });
                        const arr = Array.isArray(data) ? data : [data];
                        return makeChain(tableName, arr as Record<string, unknown>[]);
                    };
                }

                if (prop === "insert") {
                    return (data: unknown) => {
                        writes.push({ table: tableName, operation: "insert", data });
                        // Simula insert bem-sucedido (sem duplicata 23505)
                        const arr = Array.isArray(data) ? data : [data];
                        return makeChain(tableName, arr as Record<string, unknown>[]);
                    };
                }

                if (prop === "update") {
                    return (data: unknown) => {
                        writes.push({ table: tableName, operation: "update", data });
                        return makeChain(tableName, rows);
                    };
                }

                if (prop === "delete") {
                    return () => {
                        writes.push({ table: tableName, operation: "delete", data: null });
                        return makeChain(tableName, []);
                    };
                }

                // ── limit() não termina a chain (pode vir .maybeSingle() depois) ─
                if (prop === "limit") {
                    return () => makeChain(tableName, rows);
                }

                // ── Qualquer outro método (select, eq, or, order, in, gt…) ─────
                return () => makeChain(tableName, rows);
            },
        });
    }

    const client = {
        from: (t: string) => makeChain(t, tables[t] ?? []),
        rpc:  () => Promise.resolve({ data: null, error: null }),
    };

    return {
        client,
        writes,

        getLastWrite(table: string, op?: WriteRecord["operation"]) {
            const matches = writes.filter(
                (w) => w.table === table && (!op || w.operation === op),
            );
            return matches[matches.length - 1];
        },

        getAllWrites(table: string) {
            return writes.filter((w) => w.table === table);
        },

        /** Retorna o dado salvo mais recentemente em chatbot_sessions */
        sessionData() {
            const w = this.getLastWrite("chatbot_sessions");
            if (!w) return undefined;
            return Array.isArray(w.data) ? w.data[0] : w.data;
        },
    };
}

// ─── Dados base para testes ───────────────────────────────────────────────────

/** Cria uma linha de sessão com valores padrão */
export function sessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id:          "sess-integration-1",
        thread_id:   "thread-1",
        company_id:  "company-1",
        step:        "welcome",
        cart:        [],
        customer_id: null,
        context:     {},
        expires_at:  new Date(Date.now() + 3_600_000).toISOString(),
        ...overrides,
    };
}

/** Produtos mock para o catálogo do chatbot */
export const MOCK_DB_ROWS = [
    {
        id: "heine-600-un", produto_id: "prod-heine", product_volume_id: "vol-heine-600",
        descricao: "600ml", fator_conversao: 1, preco_venda: 7.50,
        tags: "heineken cerveja gelada", is_acompanhamento: false,
        sigla_comercial: "UN", product_name: "Heineken", category_id: "cat-cervejas",
        product_unit_type: "ml", product_details: "600ml", volume_quantidade: 600,
        unit_type_sigla: "ml", company_id: "company-1",
    },
    {
        id: "heine-600-cx", produto_id: "prod-heine", product_volume_id: "vol-heine-600",
        descricao: "cx 24un", fator_conversao: 24, preco_venda: 150.00,
        tags: "heineken cerveja caixa", is_acompanhamento: false,
        sigla_comercial: "CX", product_name: "Heineken", category_id: "cat-cervejas",
        product_unit_type: "ml", product_details: "600ml", volume_quantidade: 600,
        unit_type_sigla: "ml", company_id: "company-1",
    },
    {
        id: "skol-350-un", produto_id: "prod-skol", product_volume_id: "vol-skol-350",
        descricao: "350ml", fator_conversao: 1, preco_venda: 3.80,
        tags: "skol cerveja lata", is_acompanhamento: false,
        sigla_comercial: "UN", product_name: "Skol", category_id: "cat-cervejas",
        product_unit_type: "ml", product_details: "350ml", volume_quantidade: 350,
        unit_type_sigla: "ml", company_id: "company-1",
    },
    {
        id: "agua-500-un", produto_id: "prod-agua", product_volume_id: "vol-agua-500",
        descricao: "500ml", fator_conversao: 1, preco_venda: 2.50,
        tags: "agua mineral", is_acompanhamento: false,
        sigla_comercial: "UN", product_name: "Água Mineral", category_id: "cat-outros",
        product_unit_type: "ml", product_details: "500ml", volume_quantidade: 500,
        unit_type_sigla: "ml", company_id: "company-1",
    },
];

/** Cria um MockAdmin pré-populado com dados realistas para integração */
export function baseAdmin(sessionOverrides: Record<string, unknown> = {}): MockAdmin {
    return createMockAdmin({
        // ── Chatbot ───────────────────────────────────────────────────────────
        chatbots: [{ id: "bot-1", is_active: true, company_id: "company-1", config: {} }],

        // ── Empresa ───────────────────────────────────────────────────────────
        companies: [{
            id:       "company-1",
            name:     "Disk Bebidas Teste",
            settings: {
                open_time:  "08:00",
                close_time: "23:00",
                // Sem closed_message → loja está aberta
            },
        }],

        // ── Sessão ────────────────────────────────────────────────────────────
        chatbot_sessions: [sessionRow(sessionOverrides)],

        // ── Catálogo ──────────────────────────────────────────────────────────
        view_chat_produtos: MOCK_DB_ROWS,
        view_categories: [
            { id: "cat-cervejas", name: "Cervejas", is_active: true, company_id: "company-1" },
            { id: "cat-outros",   name: "Outros",   is_active: true, company_id: "company-1" },
        ],

        // ── Entrega ───────────────────────────────────────────────────────────
        delivery_zones: [
            { id: "zone-1", company_id: "company-1", label: "Centro", fee: 5.00,
              neighborhoods: ["centro", "downtown"] },
        ],

        // ── Pedidos ───────────────────────────────────────────────────────────
        orders:      [],
        order_items: [],

        // ── Clientes ──────────────────────────────────────────────────────────
        customers: [
            { id: "cust-1", company_id: "company-1", phone: "+5565999990000", name: "Teste" },
        ],
        enderecos_cliente: [],

        // ── WhatsApp ──────────────────────────────────────────────────────────
        whatsapp_threads: [
            { id: "thread-1", company_id: "company-1", bot_active: true, profile_name: null,
              phone_e164: "+5565999990000" },
        ],
        whatsapp_messages:  [],
        whatsapp_channels: [{
            id: "chan-1", company_id: "company-1",
            from_identifier: "+556500000000", provider_metadata: {},
        }],
    });
}
