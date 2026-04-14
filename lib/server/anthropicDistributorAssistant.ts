/**
 * Assistente “distribuidora” com Anthropic SDK + tools (catálogo Supabase + pedidos por telefone).
 * Usado pela rota POST /api/chatbot/assistant-tools (painel / testes internos).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import Anthropic from "@anthropic-ai/sdk";
import { runSearchProdutos } from "@/lib/chatbot/pro/searchProdutos";

const DEFAULT_MODEL         = process.env.CHATBOT_ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOOL_ROUNDS = 5;
const DEFAULT_MAX_TOKENS    = 1200;

/** Tabela lógica de catálogo: view + estoque (paridade com o motor PRO). */
export const SEARCH_PRODUCTS_TOOL = {
    name:         "search_company_products",
    description:
        "Consulta catálogo da empresa: embalagens à venda com preço e estoque aproximado. Use antes de citar preço ou disponibilidade. Se items vier vazio, não invente produto.",
    input_schema: {
        type:       "object" as const,
        properties: {
            query: {
                type:        "string",
                description: "Nome ou trecho do produto (ex.: heineken, água com gás).",
            },
            category_hint: {
                type:        "string",
                description: "Opcional: categoria (ex.: cerveja, refrigerante).",
            },
        },
        required: [],
    },
};

export const ORDERS_BY_PHONE_TOOL = {
    name:         "get_customer_orders_by_phone",
    description:
        "Lista últimos pedidos do cliente pelo telefone (status, total, itens). O telefone deve estar em E.164 quando possível (ex.: +5561999990000).",
    input_schema: {
        type:       "object" as const,
        properties: {
            phone: {
                type:        "string",
                description: "Telefone do cliente (com ou sem +)",
            },
            limit: {
                type:        "number",
                description: "Máximo de pedidos (1–10). Padrão 5.",
            },
        },
        required: ["phone"],
    },
};

export const DISTRIBUTOR_SYSTEM_PROMPT = `<role>
Você é atendente de uma distribuidora de bebidas no Brasil. Fale em português do Brasil: curto, cordial e focado em fechar a venda ou no próximo passo claro (endereço, pagamento, confirmação).
</role>

<tools_policy>
Use sempre as ferramentas para fatos: catálogo/preço/estoque (search_company_products) e situação de pedidos (get_customer_orders_by_phone). Não invente produto, preço, estoque nem status de pedido.
Se não tiver telefone para consultar pedidos, peça ao usuário ou use o telefone já informado na conversa, se existir.
</tools_policy>

<out_of_stock>
Se search_company_products retornar itens com estoque baixo ou zero, ou se o cliente pedir algo indisponível, sugira alternativa similar entre os resultados da mesma busca ou uma nova busca (ex.: outra marca na mesma categoria). Não descreva produtos que não apareceram na tool.
</out_of_stock>

<uncertainty>
Se faltar dado ou a busca não retornar o que o cliente quer, diga honestamente e ofereça reformular o pedido ou buscar outro termo.
</uncertainty>`;

function normPhoneE164(raw: string): string {
    const t = raw.trim();
    if (!t) return "";
    return t.startsWith("+") ? t : `+${t.replace(/^\+/, "")}`;
}

async function fetchOrdersByPhoneJson(
    admin: SupabaseClient,
    companyId: string,
    phone: string,
    limit: number
): Promise<Record<string, unknown>> {
    const phoneNorm = normPhoneE164(phone);
    if (!phoneNorm || phoneNorm.length < 8) {
        return { error: "invalid_phone", orders: [] };
    }
    const lim = Math.min(Math.max(Math.floor(limit) || 5, 1), 10);

    const { data: orders, error } = await admin
        .from("orders")
        .select(`
      id,
      created_at,
      status,
      confirmation_status,
      total_amount,
      delivery_fee,
      delivery_address,
      payment_method,
      change_for,
      source,
      customers!inner ( name, phone ),
      order_items ( product_name, quantity, unit_price, line_total )
    `)
        .eq("company_id", companyId)
        .eq("customers.phone", phoneNorm)
        .order("created_at", { ascending: false })
        .limit(lim);

    if (error) {
        return { error: error.message, orders: [] };
    }

    const formatted = (orders ?? []).map((o: Record<string, unknown>) => {
        const id        = String(o.id ?? "");
        const itemsRaw  = (o.order_items ?? []) as Array<Record<string, unknown>>;
        return {
            id:                 id.slice(0, 8).toUpperCase(),
            created_at:         o.created_at,
            status:             o.status,
            confirmation_status: o.confirmation_status,
            total_amount:       Number.parseFloat(String(o.total_amount ?? 0)),
            delivery_address: o.delivery_address ?? "",
            payment_method:   o.payment_method,
            items:              itemsRaw.map((i) => ({
                product_name: i.product_name,
                quantity:     i.quantity,
                unit_price:   Number.parseFloat(String(i.unit_price ?? 0)),
                line_total:   Number.parseFloat(String(i.line_total ?? 0)),
            })),
        };
    });

    return { orders: formatted, count: formatted.length };
}

async function runTool(
    name: string,
    rawInput: unknown,
    ctx: { admin: SupabaseClient; companyId: string; fallbackPhone: string | null }
): Promise<string> {
    const input = (rawInput ?? {}) as Record<string, unknown>;

    if (name === "search_company_products") {
        const query         = String(input.query ?? "");
        const categoryHint  = input.category_hint == null ? null : String(input.category_hint);
        const rows          = await runSearchProdutos(ctx.admin, ctx.companyId, query, {
            categoryHint: categoryHint?.trim() || null,
            limit:        categoryHint ? 5 : 8,
        });
        return JSON.stringify({ items: rows });
    }

    if (name === "get_customer_orders_by_phone") {
        let phone = String(input.phone ?? "").trim();
        if (!phone && ctx.fallbackPhone) phone = ctx.fallbackPhone;
        const limit = input.limit == null ? 5 : Number(input.limit);
        if (!phone) return JSON.stringify({ error: "phone_required", orders: [] });
        const payload = await fetchOrdersByPhoneJson(ctx.admin, ctx.companyId, phone, limit);
        return JSON.stringify(payload);
    }

    return JSON.stringify({ error: "unknown_tool", name });
}

export async function runDistributorAssistantWithTools(params: {
    admin:               SupabaseClient;
    companyId:           string;
    userMessage:         string;
    /** Se o cliente não passar phone na tool, usa este (ex.: contexto do WhatsApp). */
    customerPhoneE164?: string | null;
    model?:              string;
    maxToolRounds?:      number;
}): Promise<{ reply: string; model: string; tool_rounds: number }> {
    const {
        admin,
        companyId,
        userMessage,
        customerPhoneE164 = null,
        model             = DEFAULT_MODEL,
        maxToolRounds     = DEFAULT_MAX_TOOL_ROUNDS,
    } = params;

    const client = new Anthropic();
    const tools  = [SEARCH_PRODUCTS_TOOL, ORDERS_BY_PHONE_TOOL];

    let messages: MessageParam[] = [{ role: "user", content: userMessage.trim() }];

    let response = await client.messages.create({
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system:     DISTRIBUTOR_SYSTEM_PROMPT,
        tools,
        messages,
    });

    let toolRounds = 0;
    const toolCtx = {
        admin,
        companyId,
        fallbackPhone: customerPhoneE164?.trim() || null,
    };

    while (response.stop_reason === "tool_use" && toolRounds < maxToolRounds) {
        toolRounds++;
        const assistantBlocks = response.content;
        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

        for (const block of assistantBlocks) {
            if (block.type !== "tool_use") continue;
            const json = await runTool(block.name, block.input, toolCtx);
            toolResults.push({
                type:         "tool_result",
                tool_use_id:  block.id,
                content:      json,
            });
        }

        if (!toolResults.length) break;

        messages = [
            ...messages,
            { role: "assistant", content: assistantBlocks },
            { role: "user", content: toolResults },
        ];

        response = await client.messages.create({
            model,
            max_tokens: DEFAULT_MAX_TOKENS,
            system:     DISTRIBUTOR_SYSTEM_PROMPT,
            tools,
            messages,
        });
    }

    const textParts = response.content.filter((b) => b.type === "text") as { type: "text"; text: string }[];
    const reply     = textParts.map((b) => b.text).join("\n").trim();

    return { reply: reply || "(sem texto)", model, tool_rounds: toolRounds };
}
