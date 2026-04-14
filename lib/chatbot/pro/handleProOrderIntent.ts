/**
 * Chatbot PRO — primeiro contacto com IA + tool de catálogo.
 * Após N falhas de interpretação (INTENT_UNKNOWN), abre o Flow de catálogo.
 *
 * Próximas fases (spec): confirmação de pedido, morada, stock, RPC create_order_with_items.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type { ProcessMessageParams, Session } from "../types";
import { saveSession } from "../session";
import { botReply } from "../botSend";
import { sendFlowMessage } from "../../whatsapp/send";

const MAX_MISUNDERSTANDING = 4;
const MAX_TOOL_ROUNDS    = 4;

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

function sanitizeSearchQuery(raw: string): string {
    return raw.replaceAll("%", "").replaceAll("'", "").trim().slice(0, 80);
}

async function runSearchProdutos(
    admin: SupabaseClient,
    companyId: string,
    query: string
): Promise<unknown[]> {
    const q = sanitizeSearchQuery(query);
    if (!q) return [];

    const pattern = `%${q}%`;
    const { data: byName } = await admin
        .from("view_chat_produtos")
        .select(
            "id, product_name, descricao, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao"
        )
        .eq("company_id", companyId)
        .ilike("product_name", pattern)
        .limit(8);

    if (byName?.length) return byName;

    const { data: byDesc } = await admin
        .from("view_chat_produtos")
        .select(
            "id, product_name, descricao, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao"
        )
        .eq("company_id", companyId)
        .ilike("descricao", pattern)
        .limit(8);

    return byDesc ?? [];
}

const SEARCH_TOOL = {
    name:         "search_produtos",
    description:
        "Busca produtos e embalagens ativos da loja (nome e descrição). Use quando precisar de dados reais para responder.",
    input_schema: {
        type:       "object" as const,
        properties: {
            query: {
                type:        "string",
                description: "Termo principal (ex.: heineken, cerveja lata)",
            },
        },
        required: ["query"],
    },
};

const PRO_ORDER_SYSTEM = `És o assistente PRO de uma loja de bebidas (Brasil). Respondes em português do Brasil, tom curto e amigável.

Regras:
- Usa a ferramenta search_produtos quando precisares de nomes, embalagens ou preços reais da loja.
- Não inventes produtos nem preços — só o que a ferramenta devolver.
- Ainda NÃO finalizas pedidos nem pedes pagamento nesta versão: orienta a escolha e explica que a confirmação formal virá numa próxima etapa (ou convida a usar o catálogo se não houver match).
- No fim da mensagem visível para o cliente, acrescenta EXACTAMENTE uma linha nova com só INTENT_OK ou só INTENT_UNKNOWN:
  - INTENT_OK se percebeste claramente a intenção (pedido de produto, pergunta sobre artigos da loja, ou respondeste com base na ferramenta).
  - INTENT_UNKNOWN se a mensagem for irrelevante, incompreensível ou não tiveres forma segura de ajudar com o catálogo.`;

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
}): Promise<void> {
    const {
        admin, companyId, threadId, phoneE164, input, session,
        effectiveCatalogId, companyName, model, waConfig,
    } = params;

    if (!waConfig) {
        console.warn("[chatbot/pro] waConfig ausente, ignorando order_intent PRO");
        return;
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

    const client   = new Anthropic();
    const messages = [{ role: "user" as const, content: input }] as Parameters<
        typeof client.messages.create
    >[0]["messages"];

    let response = await client.messages.create({
        model,
        max_tokens: 900,
        system:     `${PRO_ORDER_SYSTEM}\n\nLoja: ${companyName}.`,
        tools:      [SEARCH_TOOL],
        messages,
    });

    let rounds = 0;
    while (response.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
        rounds++;
        const assistantBlocks = response.content;
        const toolResults: Array<{
            type: "tool_result";
            tool_use_id: string;
            content: string;
        }> = [];

        for (const block of assistantBlocks) {
            if (block.type !== "tool_use") continue;
            if (block.name !== "search_produtos") continue;
            const rawInput = block.input as { query?: string };
            const rows     = await runSearchProdutos(admin, companyId, String(rawInput?.query ?? ""));
            toolResults.push({
                type:         "tool_result",
                tool_use_id:  block.id,
                content:      JSON.stringify({ items: rows }),
            });
        }

        if (!toolResults.length) break;

        messages.push({ role: "assistant", content: assistantBlocks });
        messages.push({ role: "user", content: toolResults });

        response = await client.messages.create({
            model,
            max_tokens: 900,
            system:     `${PRO_ORDER_SYSTEM}\n\nLoja: ${companyName}.`,
            tools:      [SEARCH_TOOL],
            messages,
        });
    }

    const textParts = response.content.filter((b) => b.type === "text") as { type: "text"; text: string }[];
    const rawText   = textParts.map((b) => b.text).join("\n").trim();
    const { visible, mark } = stripIntentMarker(rawText);

    if (mark === "unknown") streak += 1;
    else if (mark === "ok") streak = 0;

    await saveSession(admin, threadId, companyId, {
        context: {
            ...session.context,
            pro_misunderstanding_streak: streak,
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
                flow_started_at:             new Date().toISOString(),
                flow_repeat_count:             0,
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
