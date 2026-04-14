/**
 * Chatbot PRO — IA com tools (catálogo, hints, rascunho de pedido) e fecho via RPC
 * após confirmação explícita do cliente (PT-BR, validado no servidor).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import Anthropic from "@anthropic-ai/sdk";
import type { ProcessMessageParams, Session } from "../types";
import { saveSession } from "../session";
import { botReply } from "../botSend";
import { sendFlowMessage } from "../../whatsapp/send";
import { formatCurrency } from "../utils";
import { getOrCreateCustomer } from "../db/orders";
import { isPortugueseOrderConfirmation, isPortugueseOrderRejection } from "./confirmationPt";
import { tryFinalizeAiOrderFromDraft } from "./finalizeAiOrder";
import type { AiOrderCanonicalDraft } from "./typesAiOrder";
import { prepareOrderDraftFromTool, type PrepareDraftToolInput } from "./prepareOrderDraft";
import { runSearchProdutos } from "./searchProdutos";
import { buildOrderHintsPayload } from "./orderHints";
import { shouldIncrementProMisunderstandingStreak } from "./orderProgressHeuristic";

const MAX_MISUNDERSTANDING = 4;
const MAX_TOOL_ROUNDS      = 6;
const MAX_STORED_MESSAGES  = 24;

const MARK_OK      = "\nINTENT_OK";
const MARK_UNKNOWN = "\nINTENT_UNKNOWN";

function stripIntentMarker(body: string): { visible: string; mark: "ok" | "unknown" | null } {
    const t = body.trimEnd();
    if (t.endsWith(MARK_OK)) {
        return { visible: t.slice(0, t.length - MARK_OK.length).trimEnd(), mark: "ok" };
    }
    if (t.endsWith(MARK_UNKNOWN)) {
        return { visible: t.slice(0, t.length - MARK_UNKNOWN.length).trimEnd(), mark: "unknown" };
    }
    return { visible: body.trim(), mark: null };
}

function formatDraftForModel(d: AiOrderCanonicalDraft): string {
    const itemLines = d.items.map(
        (i, idx) =>
            `${idx + 1}. ${i.quantity}× ${i.product_name} — ${formatCurrency(i.unit_price * i.quantity)}`
    );
    const addr = d.address;
    let addrLine = "";
    if (addr) {
        const comp = addr.complemento ? ` (${addr.complemento})` : "";
        const bairro = addr.bairro_label ?? addr.bairro;
        addrLine     = `📍 ${addr.logradouro}, ${addr.numero}${comp} — ${bairro}`;
    }
    let pm = "Dinheiro";
    if (d.payment_method === "pix") pm = "PIX";
    else if (d.payment_method === "card") pm = "Cartão";
    const fee = d.delivery_fee > 0 ? `\n🛵 Entrega: ${formatCurrency(d.delivery_fee)}` : "";
    const chg = d.change_for ? `\n💵 Troco para: ${formatCurrency(d.change_for)}` : "";
    const stateNote = d.pending_confirmation
        ? "\n(Estado: aguardando confirmação explícita do cliente — pede “sim” / “ok” para fechar.)"
        : "\n(Estado: rascunho guardado — apresenta resumo e pede confirmação.)";
    return [
        itemLines.join("\n"),
        "",
        `Subtotal itens: ${formatCurrency(d.total_items)}`,
        fee || null,
        `*Total: ${formatCurrency(d.grand_total)}*`,
        addrLine,
        `💳 ${pm}${chg}`,
        stateNote,
    ]
        .filter((x) => x !== null && x !== "")
        .join("\n");
}

const SEARCH_TOOL = {
    name:         "search_produtos",
    description:
        "Lista produtos/embalagens reais (preço e stock). Usa query de pesquisa OU category_hint (nome de categoria, ex. cerveja) para listar até 8.",
    input_schema: {
        type:       "object" as const,
        properties: {
            query: {
                type:        "string",
                description: "Termo de busca (nome ou descrição). Pode ser vazio se usares só category_hint.",
            },
            category_hint: {
                type:        "string",
                description: "Opcional: ex. “cerveja”, “refrigerante” — lista produtos dessa categoria.",
            },
        },
        required: [],
    },
};

const HINTS_TOOL = {
    name:         "get_order_hints",
    description:
        "Morada guardada / “de sempre”, favoritos e se o cliente já existe. Chama quando o cliente falar em endereço de sempre, último pedido, ou “o que costumo pedir”.",
    input_schema: {
        type:       "object" as const,
        properties: {},
    },
};

const PREPARE_DRAFT_TOOL = {
    name:         "prepare_order_draft",
    description:
        "Valida itens (UUID de produto_embalagem = id da view), morada, pagamento e stock; grava rascunho canónico no servidor. Usa use_saved_address=true para “morada de sempre”. Define ready_for_confirmation=true quando mostrares resumo final ao cliente.",
    input_schema: {
        type:       "object" as const,
        properties: {
            items: {
                type:        "array",
                description: "Linhas do pedido",
                items:       {
                    type:       "object",
                    properties: {
                        produto_embalagem_id: { type: "string", description: "UUID da embalagem (id devolvido por search_produtos)" },
                        quantity:             { type: "number", description: "Quantidade inteira na unidade de venda da embalagem" },
                    },
                    required: ["produto_embalagem_id", "quantity"],
                },
            },
            address: {
                type:        "object",
                description: "Morada; omitir se use_saved_address",
                properties: {
                    logradouro:  { type: "string" },
                    numero:      { type: "string" },
                    bairro:      { type: "string" },
                    complemento: { type: "string" },
                    apelido:     { type: "string" },
                },
            },
            use_saved_address: {
                type:        "boolean",
                description: "Quando true, preenche morada a partir do cadastro / último pedido",
            },
            payment_method: {
                type:        "string",
                description: "pix | cash | card",
            },
            change_for: {
                type:        "number",
                description: "Troco para (dinheiro); opcional",
            },
            ready_for_confirmation: {
                type:        "boolean",
                description: "true quando o pedido está completo e só falta o cliente dizer sim",
            },
        },
        required: ["items"],
    },
};

const PRO_ORDER_SYSTEM = `És o assistente PRO de uma loja de bebidas (Brasil). Português do Brasil, curto e amigável.

Capacidades:
- search_produtos: dados reais (preço, stock).
- get_order_hints: morada guardada / favoritos.
- prepare_order_draft: valida pedido no servidor (stock, zona de entrega, preços). Nunca inventes UUID — usa ids devolvidos pela busca.

Fluxo de pedido:
1) Ajuda a escolher produtos (desambigua embalagens quando necessário).
2) Garante morada com rua, número e bairro (ou use_saved_address após hints).
3) Pagamento: pix, cash ou card; troco só faz sentido com cash.
4) Quando tudo fechado, chama prepare_order_draft com ready_for_confirmation=true, mostra o resumo ao cliente e pede confirmação explícita.
5) NÃO digas que o pedido está fechado até o cliente confirmar com palavras claras (sim, ok, manda ver…). O sistema trata a confirmação na mensagem seguinte.

Marcadores no fim da tua mensagem visível (linha extra):
- INTENT_OK: percebeste a intenção ou avançaste o pedido de forma útil (inclui pedir dado em falta).
- INTENT_UNKNOWN: mensagem irrelevante ou impossível ajudar com segurança.
Não uses INTENT_UNKNOWN só porque pediste rua ou pagamento — isso é INTENT_OK.`;

type ToolName = "search_produtos" | "get_order_hints" | "prepare_order_draft";

async function runProTool(params: {
    name:        ToolName;
    rawInput:    unknown;
    admin:       SupabaseClient;
    companyId:   string;
    threadId:    string;
    phoneE164:   string;
    profileName: string | null | undefined;
    session:     Session;
}): Promise<{ toolResultJson: string; sessionPatch?: Partial<Session> }> {
    const { name, rawInput, admin, companyId, threadId, phoneE164, profileName, session } = params;
    const input = (rawInput ?? {}) as Record<string, unknown>;

    if (name === "search_produtos") {
        const query         = String(input.query ?? "");
        const categoryHint  = input.category_hint != null ? String(input.category_hint) : null;
        const rows          = await runSearchProdutos(admin, companyId, query, {
            categoryHint: categoryHint?.trim() || null,
            limit:        categoryHint ? 5 : 8,
        });
        return { toolResultJson: JSON.stringify({ items: rows }) };
    }

    if (name === "get_order_hints") {
        const hints = await buildOrderHintsPayload({
            admin, companyId, phoneE164, name: profileName ?? null,
        });
        const cid = hints.customer_id as string | undefined;
        const sessionPatch: Partial<Session> | undefined =
            cid && session.customer_id !== cid ? { customer_id: cid } : undefined;
        return { toolResultJson: JSON.stringify(hints), sessionPatch };
    }

    if (name === "prepare_order_draft") {
        const body: PrepareDraftToolInput = {
            items:                    (input.items as PrepareDraftToolInput["items"]) ?? [],
            address:                  (input.address as PrepareDraftToolInput["address"]) ?? null,
            use_saved_address:        Boolean(input.use_saved_address),
            payment_method:           input.payment_method != null ? String(input.payment_method) : null,
            change_for:               input.change_for != null ? Number(input.change_for) : null,
            ready_for_confirmation:   Boolean(input.ready_for_confirmation),
        };
        const customerId = session.customer_id;
        const res          = await prepareOrderDraftFromTool(admin, companyId, customerId, body);
        if (res.draft) {
            await saveSession(admin, threadId, companyId, {
                context: {
                    ...session.context,
                    ai_order_canonical: res.draft,
                },
            });
            Object.assign(session.context, { ai_order_canonical: res.draft });
        }
        const payload = {
            ok:     res.ok,
            errors: res.errors,
            draft:  res.draft ? formatDraftForModel(res.draft) : null,
        };
        return { toolResultJson: JSON.stringify(payload) };
    }

    return { toolResultJson: JSON.stringify({ error: "unknown_tool" }) };
}

function loadStoredMessages(ctx: Record<string, unknown>): MessageParam[] {
    const raw = ctx.pro_anthropic_messages;
    if (!Array.isArray(raw)) return [];
    return raw.slice(-MAX_STORED_MESSAGES) as MessageParam[];
}

export async function handleProOrderIntent(params: {
    admin:                 SupabaseClient;
    companyId:             string;
    threadId:              string;
    phoneE164:             string;
    input:                 string;
    session:               Session;
    effectiveCatalogId?: string;
    companyName:           string;
    model:                 string;
    waConfig:              ProcessMessageParams["waConfig"];
    profileName?:          string | null;
}): Promise<void> {
    const {
        admin, companyId, threadId, phoneE164, input, session,
        effectiveCatalogId, companyName, model, waConfig, profileName,
    } = params;

    if (!waConfig) {
        console.warn("[chatbot/pro] waConfig ausente, ignorando order_intent PRO");
        return;
    }

    const cust = await getOrCreateCustomer(admin, companyId, phoneE164, profileName ?? null);
    if (cust?.id && session.customer_id !== cust.id) {
        session.customer_id = cust.id;
        await saveSession(admin, threadId, companyId, { customer_id: cust.id });
    }

    const draftExisting = session.context.ai_order_canonical as AiOrderCanonicalDraft | undefined;

    if (draftExisting?.pending_confirmation) {
        if (isPortugueseOrderRejection(input)) {
            await saveSession(admin, threadId, companyId, {
                context: {
                    ...session.context,
                    ai_order_canonical:       undefined,
                    pro_anthropic_messages:   [],
                    pro_misunderstanding_streak: 0,
                },
            });
            await botReply(admin, companyId, threadId, phoneE164, "Tudo bem — cancelei esse pedido. Quando quiseres, diz o que precisas. 😊");
            return;
        }
        if (isPortugueseOrderConfirmation(input)) {
            const placed = await tryFinalizeAiOrderFromDraft({
                admin,
                companyId,
                phoneE164,
                profileName,
                draft: draftExisting,
            });
            if (placed.ok) {
                await saveSession(admin, threadId, companyId, {
                    step:    "main_menu",
                    context: {
                        ...session.context,
                        ai_order_canonical:          undefined,
                        pro_anthropic_messages:      [],
                        pro_misunderstanding_streak: 0,
                    },
                });
                await botReply(admin, companyId, threadId, phoneE164, placed.customerMessage);
                return;
            }
            await botReply(admin, companyId, threadId, phoneE164, placed.customerMessage);
            return;
        }
    }

    let streak = Number(session.context.pro_misunderstanding_streak ?? 0);
    if (streak >= MAX_MISUNDERSTANDING) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_flow",
            context: {
                ...session.context,
                pro_misunderstanding_streak: 0,
                flow_started_at:             new Date().toISOString(),
                flow_repeat_count:             0,
            },
        });
        if (effectiveCatalogId) {
            await sendFlowMessage(
                phoneE164,
                {
                    flowId:    effectiveCatalogId,
                    flowToken: `${threadId}|${companyId}|catalog`,
                    bodyText:  `Para montar o teu pedido com tudo certinho, usa o catálogo do *${companyName}* aqui em baixo. 😊`,
                    ctaLabel:  "Ver Catálogo",
                },
                waConfig
            );
        }
        return;
    }

    const client = new Anthropic();

    let messages = [...loadStoredMessages(session.context), { role: "user" as const, content: input }] as MessageParam[];

    let response = await client.messages.create({
        model,
        max_tokens: 1200,
        system:     `${PRO_ORDER_SYSTEM}\n\nLoja: ${companyName}.`,
        tools:      [SEARCH_TOOL, HINTS_TOOL, PREPARE_DRAFT_TOOL],
        messages,
    });

    let toolRoundsUsed = 0;
    while (response.stop_reason === "tool_use" && toolRoundsUsed < MAX_TOOL_ROUNDS) {
        toolRoundsUsed++;
        const assistantBlocks = response.content;
        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

        for (const block of assistantBlocks) {
            if (block.type !== "tool_use") continue;
            const tName = block.name as ToolName;
            if (tName !== "search_produtos" && tName !== "get_order_hints" && tName !== "prepare_order_draft") continue;

            const { toolResultJson, sessionPatch } = await runProTool({
                name:        tName,
                rawInput:    block.input,
                admin,
                companyId,
                threadId,
                phoneE164,
                profileName,
                session,
            });
            if (sessionPatch?.customer_id) {
                session.customer_id = sessionPatch.customer_id;
                await saveSession(admin, threadId, companyId, { customer_id: sessionPatch.customer_id });
            }
            toolResults.push({
                type:         "tool_result",
                tool_use_id:  block.id,
                content:      toolResultJson,
            });
        }

        if (!toolResults.length) break;

        messages = [
            ...messages,
            { role: "assistant" as const, content: assistantBlocks },
            { role: "user" as const, content: toolResults },
        ];

        response = await client.messages.create({
            model,
            max_tokens: 1200,
            system:     `${PRO_ORDER_SYSTEM}\n\nLoja: ${companyName}.`,
            tools:      [SEARCH_TOOL, HINTS_TOOL, PREPARE_DRAFT_TOOL],
            messages,
        });
    }

    const textParts = response.content.filter((b) => b.type === "text") as { type: "text"; text: string }[];
    const rawText   = textParts.map((b) => b.text).join("\n").trim();
    const { visible, mark } = stripIntentMarker(rawText);

    if (mark === "unknown") {
        if (shouldIncrementProMisunderstandingStreak({
            userInput:    input,
            toolRoundsUsed,
            visibleReply: visible,
        })) {
            streak += 1;
        }
    } else if (mark === "ok") {
        streak = 0;
    }

    messages = [...messages, { role: "assistant" as const, content: response.content }].slice(
        -MAX_STORED_MESSAGES
    ) as MessageParam[];

    await saveSession(admin, threadId, companyId, {
        context: {
            ...session.context,
            pro_misunderstanding_streak: streak,
            pro_anthropic_messages:        messages as unknown as Record<string, unknown>,
        },
    });

    const reply = visible.length > 0 ? visible : "Não consegui perceber bem — diz-me o que queres pedir ou escolhe uma opção do menu. 😊";
    await botReply(admin, companyId, threadId, phoneE164, reply);

    if (streak >= MAX_MISUNDERSTANDING && effectiveCatalogId) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_flow",
            context: {
                ...session.context,
                pro_misunderstanding_streak: 0,
                pro_anthropic_messages:        [],
                ai_order_canonical:            undefined,
                flow_started_at:               new Date().toISOString(),
                flow_repeat_count:               0,
            },
        });
        await sendFlowMessage(
            phoneE164,
            {
                flowId:    effectiveCatalogId,
                flowToken: `${threadId}|${companyId}|catalog`,
                bodyText:  `Vamos pelo formulário do *${companyName}* — assim não falha nada no pedido. 🍺`,
                ctaLabel:  "Ver Catálogo",
            },
            waConfig
        );
    }
}
