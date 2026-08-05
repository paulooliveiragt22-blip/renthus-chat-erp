/**
 * lib/chatbot/handlers/handleFAQ.ts
 *
 * Responde dúvidas do cliente via `LlmPort` (Anthropic ou OpenAI).
 * NUNCA aceita pedidos nem confirma compras — oferece cardápio web (se ativo) ou Flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, CompanyConfig, ProcessMessageParams } from "../types";
import { botReply } from "../botSend";
import { sendInteractiveButtons } from "../../whatsapp/send";
import { sanitizeClaudeReply } from "../utils";
import { offerCatalogToCustomer } from "../offerCatalog";
import { createLlmPort, getConfiguredLlmProvider } from "@/src/pro/adapters/llm/createLlmPort";
import { extractLlmPlainText, hasLlmApiKey } from "@/src/pro/adapters/llm/llmText";

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
    const provider = getConfiguredLlmProvider();
    const defaultModel =
        provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001";
    const model = String(config.botConfig.model ?? process.env.LLM_MODEL ?? defaultModel);

    const products    = await getFAQProducts(admin, companyId);
    const productList = products.slice(0, 60)
        .map((p) => `• ${p.name}: R$ ${p.price.toFixed(2)}`)
        .join("\n");

    if (!hasLlmApiKey(provider)) {
        await botReply(
            admin,
            companyId,
            threadId,
            phoneE164,
            "Não consegui buscar essa informação agora. Veja nosso catálogo ou fale com um atendente. 😊"
        );
    } else {
        try {
            const llm = createLlmPort(admin);
            const resp = await llm.chat({
                model,
                maxTokens: 250,
                timeoutMs: 25_000,
                companyId,
                purpose: "legacy_faq",
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

            const rawReply = extractLlmPlainText(resp.content);
            const catalogPrices = products.map((p) => p.price);
            const safeReply = sanitizeClaudeReply(rawReply, catalogPrices);

            await botReply(admin, companyId, threadId, phoneE164, safeReply);
        } catch (err) {
            console.error("[handleFAQ] LLM error:", err);
            await botReply(
                admin,
                companyId,
                threadId,
                phoneE164,
                "Não consegui buscar essa informação agora. Veja nosso catálogo ou fale com um atendente. 😊"
            );
        }
    }

    // Sempre oferece o catálogo após responder (web menu ativo → link; senão Flow)
    const effectiveFlowId = catalogFlowId ?? process.env.WHATSAPP_CATALOG_FLOW_ID;
    const offered = await offerCatalogToCustomer({
        admin,
        companyId,
        threadId,
        phoneE164,
        companyName,
        session,
        waConfig,
        flowCatalogId: effectiveFlowId,
        flowBodyText: "Quer ver nosso catálogo completo e fazer seu pedido?",
        flowCtaLabel: "Ver Catálogo",
    });
    if (offered === "none") {
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
