/**
 * lib/chatbot/handlers/handleFAQ.ts
 *
 * Responde dúvidas do cliente usando Claude Haiku.
 * NUNCA aceita pedidos nem confirma compras — sempre redireciona para o Flow Catálogo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type { Session, CompanyConfig } from "../types";
import type { ProcessMessageParams } from "../types";
import { botReply } from "../botSend";
import { sendFlowMessage, sendInteractiveButtons } from "../../whatsapp/send";
import { sanitizeClaudeReply } from "../utils";
import { saveSession } from "../session";

// ── Cache de produtos para FAQ ─────────────────────────────────────────────────

interface FAQProduct { name: string; price: number }

const faqCache = new Map<string, { products: FAQProduct[]; expiresAt: number }>();
const FAQ_TTL  = 10 * 60 * 1000;

async function getFAQProducts(
    admin: SupabaseClient,
    companyId: string
): Promise<FAQProduct[]> {
    const cached = faqCache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) return cached.products;

    const { data } = await admin
        .from("view_chat_produtos")
        .select("product_name, preco_venda, sigla_comercial, descricao")
        .eq("company_id", companyId)
        .eq("sigla_comercial", "UN")
        .order("product_name")
        .limit(120);

    const products: FAQProduct[] = (data ?? []).map((r: any) => ({
        name:  `${r.product_name}${r.descricao ? " " + r.descricao : ""}`,
        price: Number(r.preco_venda ?? 0),
    }));

    faqCache.set(companyId, { products, expiresAt: Date.now() + FAQ_TTL });
    return products;
}

export function invalidateFAQCache(companyId: string): void {
    faqCache.delete(companyId);
}

// ── Handler principal ──────────────────────────────────────────────────────────

export async function handleFAQ(
    params: ProcessMessageParams,
    session: Session,
    config: CompanyConfig
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, waConfig, catalogFlowId } = params;
    const companyName = config.name;
    const model       = String(config.botConfig.model ?? "claude-haiku-4-5-20251001");

    const products    = await getFAQProducts(admin, companyId);
    const productList = products.slice(0, 60)
        .map((p) => `• ${p.name}: R$ ${p.price.toFixed(2)}`)
        .join("\n");

    const client = new Anthropic();

    try {
        const resp = await client.messages.create({
            model,
            max_tokens: 250,
            system: `Você é um assistente do ${companyName}. REGRAS ABSOLUTAS:
1. Responda dúvidas sobre produtos, preços, horários, entrega e formas de pagamento.
2. NUNCA faça pedidos, confirme compras, adicione itens ou realize transações.
3. Informe SOMENTE preços listados abaixo. Se não estiver listado, diga "não tenho esse valor disponível".
4. Se perguntarem onde pedir ou como comprar: diga "use o catálogo pelo botão abaixo".
5. Resposta máx 3 frases curtas em português brasileiro.
6. NUNCA invente informações.

PRODUTOS DISPONÍVEIS:
${productList || "Catálogo em atualização. Use o botão abaixo para ver os produtos."}`,
            messages: [{ role: "user", content: params.text }],
        });

        const rawReply  = ((resp.content[0] as { text: string }).text ?? "").trim();
        const catalogPrices = products.map((p) => p.price);
        const safeReply = sanitizeClaudeReply(rawReply, catalogPrices);

        await botReply(admin, companyId, threadId, phoneE164, safeReply);
    } catch (err) {
        console.error("[handleFAQ] Claude error:", err);
        await botReply(admin, companyId, threadId, phoneE164,
            "Não consegui buscar essa informação agora. Veja nosso catálogo ou fale com um atendente. 😊");
    }

    // Sempre oferece o catálogo após responder
    const effectiveFlowId = catalogFlowId ?? process.env.WHATSAPP_CATALOG_FLOW_ID;

    if (effectiveFlowId) {
        await saveSession(admin, threadId, companyId, {
            step:    "awaiting_flow",
            context: {
                ...session.context,
                flow_started_at:   new Date().toISOString(),
                flow_repeat_count: 0,
            },
        });
        await sendFlowMessage(
            phoneE164,
            {
                flowId:    effectiveFlowId,
                flowToken: `${threadId}|${companyId}|catalog`,
                bodyText:  "Quer ver nosso catálogo completo e fazer seu pedido?",
                ctaLabel:  "Ver Catálogo",
            },
            waConfig
        );
    } else {
        await sendInteractiveButtons(
            phoneE164,
            "Como posso te ajudar?",
            [
                { id: "btn_catalog", title: "🛒 Ver Catálogo" },
                { id: "btn_support", title: "🙋 Falar c/ atendente" },
            ],
            waConfig
        );
    }
}
