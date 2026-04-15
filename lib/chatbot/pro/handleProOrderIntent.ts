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
import { sendInteractiveButtons } from "../../whatsapp/send";
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
const MAX_TOOL_ROUNDS      = 12;
const MAX_STORED_MESSAGES  = 24;

const MSG_PRO_ESCALATION_CHOICE =
    "Não estou conseguindo entender bem. O que você prefere?\n\n" +
    "1️⃣ Ver o *catálogo* (formulário)\n" +
    "2️⃣ *Falar com um atendente*\n" +
    "3️⃣ *Tentar de novo* em texto livre\n\n" +
    "Responda com o número ou escreva catálogo / atendente / tentar de novo.";

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
        const extra  = [addr.cidade, addr.estado, addr.cep].filter(Boolean).join(" · ");
        if (extra) addrLine += `\n📌 ${extra}`;
    }
    let pm = "Dinheiro";
    if (d.payment_method === "pix") pm = "PIX";
    else if (d.payment_method === "card") pm = "Cartão";
    const fee = d.delivery_fee > 0 ? `\n🛵 Entrega: ${formatCurrency(d.delivery_fee)}` : "";
    const eta = d.delivery_eta_min != null ? `\n⏱️ Previsão: ${Math.max(0, Math.floor(d.delivery_eta_min))} min` : "";
    const minOrder = d.delivery_min_order != null
        ? `\n📌 Pedido mínimo: ${formatCurrency(d.delivery_min_order)}`
        : "";
    const chg = d.change_for ? `\n💵 Troco para: ${formatCurrency(d.change_for)}` : "";
    const stateNote = d.pending_confirmation
        ? "\n(Estado: aguardando confirmação explícita do cliente — peça “sim” / “ok” para fechar.)"
        : "\n(Estado: rascunho salvo — apresente o resumo e peça confirmação.)";
    return [
        itemLines.join("\n"),
        "",
        `Subtotal itens: ${formatCurrency(d.total_items)}`,
        fee || null,
        minOrder || null,
        eta || null,
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
        "Fonte de verdade para catálogo: devolve produtos/embalagens reais (preço e estoque) da base. Sempre chame antes de citar preço ou antes de prepare_order_draft com um produto. Se items vier vazio, NÃO invente produto nem preço — diga que não achou e ofereça outra busca. Use query e/ou category_hint (ex.: cerveja); até ~8 resultados.",
    input_schema: {
        type:       "object" as const,
        properties: {
            query: {
                type:        "string",
                description: "Termo de busca (nome ou descrição). Pode ficar vazio se usar só category_hint.",
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
        "Dados reais do cadastro: saved_addresses (todos os endereços em enderecos_cliente), saved_address (principal/último), favoritos, customer_known. Antes de pedir endereço novo ao cliente, mostre o conteúdo de saved_addresses (se não for vazio). Para usar um cadastrado, chame prepare_order_draft com saved_address_id = id da linha escolhida. Não invente endereço.",
    input_schema: {
        type:       "object" as const,
        properties: {},
    },
};

const PREPARE_DRAFT_TOOL = {
    name:         "prepare_order_draft",
    description:
        "Validação no servidor: UUID produto_embalagem_id tem de ser exatamente um id já retornado por search_produtos nesta conversa (nunca invente ou complete UUID). Endereço, pagamento, estoque e zona de entrega são checados aqui; totais e erros no JSON da tool prevalecem sobre o que você inferiu. Se errors não for vazio, corrija com base nessas mensagens — não contradiga o servidor. Para endereço já cadastrado use saved_address_id (UUID de get_order_hints.saved_addresses) OU use_saved_address=true (principal/último). Para endereço digitado use address com logradouro, numero, bairro e se souber cidade, estado, cep em campos separados (não junte tudo no logradouro). ready_for_confirmation=true só ao mostrar resumo final pedindo “sim”/“ok”.",
    input_schema: {
        type:       "object" as const,
        properties: {
            items: {
                type:        "array",
                description: "Linhas do pedido",
                items:       {
                    type:       "object",
                    properties: {
                        produto_embalagem_id: {
                            type:        "string",
                            description: "UUID copiado de um item retornado por search_produtos nesta conversa (caractere a caractere). Proibido chutar ou gerar.",
                        },
                        quantity: {
                            type:        "number",
                            description: "Quantidade inteira ≥ 1 na unidade de venda da embalagem (número)",
                        },
                    },
                    required: ["produto_embalagem_id", "quantity"],
                },
            },
            address: {
                type:        "object",
                description: "Endereço estruturado; omitir se saved_address_id, use_saved_address ou address_raw",
                properties: {
                    logradouro:  { type: "string" },
                    numero:      { type: "string" },
                    bairro:      { type: "string" },
                    complemento: { type: "string" },
                    apelido:     { type: "string" },
                    cidade:      { type: "string" },
                    estado:      { type: "string" },
                    cep:         { type: "string" },
                },
            },
            address_raw: {
                type:        "string",
                description:
                    "Opcional: uma linha só (ex.: Rua Tangará 850 São Mateus). O servidor tenta separar logradouro, número e bairro.",
            },
            saved_address_id: {
                type:        "string",
                description: "UUID de uma linha de get_order_hints.saved_addresses (mesmo cliente).",
            },
            use_saved_address: {
                type:        "boolean",
                description: "Quando true, preenche o endereço a partir do cadastro ou do último pedido",
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

const PRO_ORDER_SYSTEM = `<role>
Você é o assistente PRO de uma loja de bebidas no Brasil. Fale em português do Brasil (PT-BR), curto e amigável. Diga “endereço”, nunca “morada”.
</role>

<grounding>
Preços, nomes de embalagem, estoque e totais do pedido vêm APENAS do JSON retornado pelas tools (search_produtos, prepare_order_draft, get_order_hints). Não use conhecimento geral de marcas, preços de mercado nem “o que costuma custar”.
Se não tiver chamado search_produtos para aquele produto, não afirme preço nem disponibilidade.
Se prepare_order_draft devolver errors ou ok:false, não invente outro resultado — explique ao cliente com base nas errors ou peça o dado que falta.
</grounding>

<forbidden>
- Inventar, completar ou “adivinhar” UUID (produto_embalagem_id).
- Citar preço, promoção ou estoque sem item correspondente no último resultado de search_produtos (ou no draft retornado por prepare_order_draft).
- Dizer que o pedido foi fechado, enviado ou pago antes da confirmação explícita do cliente (o servidor confirma na mensagem seguinte).
</forbidden>

<uncertainty>
Pode e DEVE dizer claramente quando não tiver base: ex. “Não encontrei esse produto na busca agora”, “Sem esse dado não consigo fechar”, “Prefiro confirmar no catálogo”. Isso reduz erro grave; não preencha lacunas com suposição.
</uncertainty>

<tools>
- search_produtos: catálogo real (preço e estoque). Sempre antes de prometer produto/preço.
- get_order_hints: endereço salvo, favoritos, se o cliente existe — só fatos do JSON da tool.
- prepare_order_draft: valida no servidor; ids de item = só os UUID listados por search_produtos nesta conversa. Pode usar address_raw (uma linha) ou address estruturado.
</tools>

<order_flow>
1) Escolha de produtos: se o pedido for vago ou houver várias embalagens, use search_produtos e ofereça só opções retornadas.
2) Endereço: chame get_order_hints cedo. Se saved_addresses não for vazio, mostre TODOS ao cliente (apelido, rua, nº, bairro, cidade se houver) antes de pedir endereço novo. Se o cliente escolher um cadastrado, use prepare_order_draft com saved_address_id = id da linha. Senão peça logradouro, número e bairro em campos claros (e cidade/CEP se possível); use_saved_address=true só para o padrão (principal/último) quando o cliente disser “de sempre” e bater com saved_address.
3) Pagamento: pix, cash ou card; troco (change_for) só com cash.
4) Quando completo, prepare_order_draft com ready_for_confirmation=true, mostre o resumo (alinhado ao draft da tool) e peça confirmação explícita.
5) Até o cliente dizer sim/ok/etc., o pedido continua em rascunho — não diga que já foi registrado de forma definitiva.
</order_flow>

<few_shot>
<ex id="1">
Cliente: “Quero uma Antarctica”
Você: chama search_produtos. Se items tiver linhas, responde só com nomes/preços dessas linhas. Se items for [], diz que não achou e sugere reformular a busca ou outro termo — sem inventar produto.
</ex>
<ex id="2">
Cliente: “Põe 2 da segunda opção”
Você: só pode usar id da “segunda opção” se ela existir no último resultado de search_produtos visível na conversa; senão pede qual produto ou busca de novo.
</ex>
<ex id="3">
prepare_order_draft retornou errors: ["Estoque insuficiente…"]
Você: informa o cliente com essa mensagem (ou parafraseando sem mudar o fato), oferece ajustar quantidade ou trocar embalagem — não afirme que o pedido está ok.
</ex>
</few_shot>

<intent_markers>
No fim da mensagem visível ao cliente, linha extra:
- INTENT_OK: entendeu a intenção ou avançou o pedido de forma útil (inclui pedir dado em falta ou dizer que não achou na busca).
- INTENT_UNKNOWN: irrelevante ou não pode ajudar com segurança.
Não use INTENT_UNKNOWN só porque pediu rua, endereço ou pagamento — isso é INTENT_OK.
</intent_markers>`;

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
            address_raw:              input.address_raw != null ? String(input.address_raw) : null,
            saved_address_id:         input.saved_address_id != null ? String(input.saved_address_id) : null,
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
        companyName, model, waConfig, profileName,
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

    // Qualquer rascunho válido em sessão pode ser fechado com sim/não (pending_confirmation no JSON antigo pode ser false).
    if (draftExisting) {
        if (isPortugueseOrderRejection(input)) {
            await saveSession(admin, threadId, companyId, {
                context: {
                    ...session.context,
                    ai_order_canonical:          undefined,
                    pro_anthropic_messages:      [],
                    pro_misunderstanding_streak: 0,
                    pro_escalation_tier:         0,
                },
            });
            await botReply(admin, companyId, threadId, phoneE164, "Tudo bem — cancelei esse pedido. Quando quiser, é só dizer o que precisa. 😊");
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
                        pro_escalation_tier:         0,
                    },
                });
                await botReply(admin, companyId, threadId, phoneE164, placed.customerMessage);
                return;
            }
            await botReply(admin, companyId, threadId, phoneE164, placed.customerMessage);
            return;
        }
    }

    const escTierBefore = Number(session.context.pro_escalation_tier ?? 0);
    let streak          = Number(session.context.pro_misunderstanding_streak ?? 0);

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

    let nextTier = Number(session.context.pro_escalation_tier ?? 0);
    if (mark === "ok") nextTier = 0;

    let nextStep = session.step;
    let escalate: "none" | "choice" | "buttons" = "none";
    let clearAiDraft = false;
    if (streak >= MAX_MISUNDERSTANDING) {
        if (escTierBefore < 1) {
            escalate     = "choice";
            streak       = 0;
            nextTier     = 1;
            nextStep     = "pro_escalation_choice";
            clearAiDraft = true;
        } else {
            escalate     = "buttons";
            streak       = 0;
            nextTier     = 2;
            nextStep     = "main_menu";
            clearAiDraft = true;
        }
    }

    const nextCtx: Record<string, unknown> = {
        ...session.context,
        pro_misunderstanding_streak: streak,
        pro_escalation_tier:         nextTier,
        pro_anthropic_messages:      (clearAiDraft ? [] : messages) as unknown as Record<string, unknown>,
    };
    if (clearAiDraft) nextCtx.ai_order_canonical = undefined;

    await saveSession(admin, threadId, companyId, { step: nextStep, context: nextCtx });
    session.step    = nextStep;
    session.context = nextCtx;

    const reply = visible.length > 0 ? visible : "Não entendi direito — me diga o que quer pedir em texto. 😊";
    await botReply(admin, companyId, threadId, phoneE164, reply);

    if (escalate === "choice") {
        await botReply(admin, companyId, threadId, phoneE164, MSG_PRO_ESCALATION_CHOICE);
    } else if (escalate === "buttons") {
        await sendInteractiveButtons(
            phoneE164,
            `No *${companyName}*, como prefere continuar?`,
            [
                { id: "btn_catalog", title: "🛒 Ver Catálogo" },
                { id: "btn_status", title: "📦 Meu pedido" },
                { id: "btn_support", title: "🙋 Falar c/ atendente" },
            ],
            waConfig
        );
    }
}
