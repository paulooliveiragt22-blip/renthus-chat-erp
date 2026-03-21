/**
 * app/api/whatsapp/flows/route.ts
 *
 * Endpoint de dados para WhatsApp Flows (Meta).
 *
 * Recebe payloads criptografados da Meta, processa e retorna respostas criptografadas.
 *
 * Fluxo do checkout (Fase 1):
 *   INIT        → retorna dados iniciais para tela ADDRESS (bairros + resumo do carrinho)
 *   ADDRESS     → valida endereço, salva no contexto, retorna tela PAYMENT
 *   PAYMENT     → salva pagamento, envia resumo via WhatsApp, retorna tela SUCCESS
 *
 * Variáveis de ambiente:
 *   WHATSAPP_FLOWS_PRIVATE_KEY — chave privada RSA PEM (PKCS#8) gerada localmente
 *   WHATSAPP_FLOW_ID           — ID do Flow registrado no Meta Business Manager
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptFlowRequest, encryptFlowResponse } from "@/lib/whatsapp/flowCrypto";
import { sendWhatsAppMessage, sendInteractiveButtons } from "@/lib/whatsapp/send";
import { getWhatsAppConfig } from "@/lib/whatsapp/getConfig";

export const runtime = "nodejs";

// ─── Tipos internos do Flow ───────────────────────────────────────────────────

interface FlowRequestBody {
    version:    string;
    action:     "ping" | "INIT" | "data_exchange";
    flow_token: string;
    screen?:    string;
    data?:      Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCart(cart: Array<{ name: string; qty: number; price: number }>): string {
    if (!cart.length) return "(carrinho vazio)";
    const lines = cart.map((i) => `${i.qty}x ${i.name} — ${formatCurrency(i.price * i.qty)}`);
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    return `${lines.join("\n")}\n\n*Total: ${formatCurrency(total)}*`;
}

/** Decodifica o flow_token para obter threadId e companyId */
function parseFlowToken(token: string): { threadId: string; companyId: string } | null {
    const parts = token.split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { threadId: parts[0], companyId: parts[1] };
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    // Lê body raw (Meta envia application/json com campos de criptografia)
    let rawBody: { encrypted_flow_data: string; encrypted_aes_key: string; initial_vector: string };
    try {
        rawBody = await req.json();
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = rawBody;
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Decripta — precisamos do flow_token para saber o companyId,
    // então tentamos resolver a chave privada em duas etapas:
    // 1ª tentativa: chave global (env var)
    // 2ª tentativa: após extrair companyId, chave da empresa
    let flowBody: FlowRequestBody;
    let aesKey: Buffer;
    let iv: Buffer;

    // Tentativa com chave global primeiro
    const globalKey = process.env.WHATSAPP_FLOWS_PRIVATE_KEY;
    if (!globalKey) {
        console.error("[flows] WHATSAPP_FLOWS_PRIVATE_KEY não definida");
        return NextResponse.json({ error: "misconfigured" }, { status: 500 });
    }

    try {
        const result = decryptFlowRequest(encrypted_flow_data, encrypted_aes_key, initial_vector, globalKey);
        flowBody = result.body as unknown as FlowRequestBody;
        aesKey   = result.aesKey;
        iv       = result.iv;
    } catch {
        // Pode ser que a empresa tenha chave própria — tenta com a chave da empresa
        // Para isso precisamos extrair o companyId do flow_token sem decriptar (não é possível)
        // Portanto: a chave global DEVE corresponder à chave registrada no Meta para este número.
        // Chaves por empresa são suportadas quando a empresa usa número próprio via company_integrations.
        console.error("[flows] Falha na decriptação com chave global");
        return NextResponse.json({ error: "decryption_failed" }, { status: 421 });
    }

    const { action, flow_token, screen, data: formData } = flowBody;

    // ── health check ─────────────────────────────────────────────────────────
    if (action === "ping") {
        const response = encryptFlowResponse({ version: "3.0", data: { status: "active" } }, aesKey, iv);
        return new NextResponse(response, { headers: { "Content-Type": "text/plain" } });
    }

    // ── INIT — retorna dados iniciais da tela ADDRESS ─────────────────────────
    if (action === "INIT") {
        const ids = parseFlowToken(flow_token);
        if (!ids) {
            return encryptedError("invalid_token", aesKey, iv);
        }

        const { threadId, companyId } = ids;

        // Carrega bairros (delivery_zones) e carrinho da sessão
        const [zonesResult, sessionResult] = await Promise.all([
            admin
                .from("delivery_zones")
                .select("id, label, fee")
                .eq("company_id", companyId)
                .eq("is_active", true)
                .order("fee", { ascending: true })
                .limit(20),
            admin
                .from("chatbot_sessions")
                .select("cart, context")
                .eq("thread_id", threadId)
                .maybeSingle(),
        ]);

        const bairros = (zonesResult.data ?? []).map((z) => ({
            id:    z.id,
            title: `${z.label}${z.fee > 0 ? ` (+${formatCurrency(z.fee)})` : " (grátis)"}`,
        }));

        const cart = (sessionResult.data?.cart ?? []) as Array<{ name: string; qty: number; price: number }>;
        const cartSummary = formatCart(cart);

        const response = encryptFlowResponse(
            {
                version: "3.0",
                screen:  "ADDRESS",
                data:    {
                    bairros,
                    cart_summary: cartSummary,
                },
            },
            aesKey,
            iv
        );
        return new NextResponse(response, { headers: { "Content-Type": "text/plain" } });
    }

    // ── data_exchange ─────────────────────────────────────────────────────────
    if (action === "data_exchange") {
        const ids = parseFlowToken(flow_token);
        if (!ids) return encryptedError("invalid_token", aesKey, iv);

        const { threadId, companyId } = ids;

        // ── Tela ADDRESS → navega para PAYMENT ───────────────────────────────
        if (screen === "ADDRESS") {
            const rua         = String(formData?.rua         ?? "").trim();
            const numero      = String(formData?.numero      ?? "").trim();
            const complemento = String(formData?.complemento ?? "").trim();
            const bairroId    = String(formData?.bairro      ?? "");
            const apelido     = String(formData?.apelido     ?? "").trim() || "Entrega";

            if (!rua || !numero || !bairroId) {
                return encryptedError("missing_address_fields", aesKey, iv);
            }

            // Busca zona de entrega
            const { data: zoneRow } = await admin
                .from("delivery_zones")
                .select("id, label, fee")
                .eq("id", bairroId)
                .maybeSingle();

            const bairroLabel = zoneRow?.label ?? bairroId;
            const deliveryFee = zoneRow ? Number(zoneRow.fee) : 0;
            const address     = [rua, numero, complemento, bairroLabel]
                .filter(Boolean)
                .join(", ");

            // Salva endereço na sessão (step mantido em awaiting_flow)
            const { data: sessionRow } = await admin
                .from("chatbot_sessions")
                .select("cart, context")
                .eq("thread_id", threadId)
                .maybeSingle();

            const cart    = (sessionRow?.cart    ?? []) as Array<{ name: string; qty: number; price: number }>;
            const context = (sessionRow?.context ?? {}) as Record<string, unknown>;

            await admin
                .from("chatbot_sessions")
                .update({
                    context: {
                        ...context,
                        delivery_address:  address,
                        delivery_fee:      deliveryFee,
                        delivery_zone_id:  zoneRow?.id ?? null,
                        flow_address_done: true,
                        flow_apelido:      apelido,
                        flow_rua:          rua,
                        flow_numero:       numero,
                        flow_complemento:  complemento,
                        flow_bairro_label: bairroLabel,
                    },
                })
                .eq("thread_id", threadId);

            // Monta resumo para a tela PAYMENT
            const totalProducts = cart.reduce((s: number, i: any) => s + i.price * i.qty, 0);
            const grandTotal    = totalProducts + deliveryFee;
            const feeText       = deliveryFee > 0 ? `\n🛵 Taxa ${bairroLabel}: ${formatCurrency(deliveryFee)}` : "";
            const cartSummary   = `${formatCart(cart)}${feeText}\n\n💰 *Total: ${formatCurrency(grandTotal)}*`;

            const response = encryptFlowResponse(
                {
                    version: "3.0",
                    screen:  "PAYMENT",
                    data:    {
                        address_display: `📍 ${address}`,
                        cart_summary:    cartSummary,
                    },
                },
                aesKey,
                iv
            );
            return new NextResponse(response, { headers: { "Content-Type": "text/plain" } });
        }

        // ── Tela PAYMENT → conclui, envia confirmação e retorna SUCCESS ───────
        if (screen === "PAYMENT") {
            const paymentMethod = String(formData?.payment_method ?? "").trim();
            const trocoStr      = String(formData?.troco_para     ?? "").trim();
            const changeFor     = trocoStr ? parseFloat(trocoStr.replace(",", ".")) || null : null;

            if (!paymentMethod) {
                return encryptedError("missing_payment_method", aesKey, iv);
            }

            // Carrega sessão atualizada (com endereço já salvo)
            const { data: sessionRow } = await admin
                .from("chatbot_sessions")
                .select("id, cart, context, customer_id")
                .eq("thread_id", threadId)
                .maybeSingle();

            if (!sessionRow) {
                return encryptedError("session_not_found", aesKey, iv);
            }

            const cart    = (sessionRow.cart    ?? []) as Array<{ name: string; qty: number; price: number; variantId?: string; productId?: string; isCase?: boolean }>;
            const context = (sessionRow.context ?? {}) as Record<string, unknown>;
            const address = (context.delivery_address as string) ?? "";

            if (!address) {
                return encryptedError("address_missing_in_session", aesKey, iv);
            }

            // Atualiza sessão para checkout_confirm com todos os dados
            await admin
                .from("chatbot_sessions")
                .update({
                    step:    "checkout_confirm",
                    context: {
                        ...context,
                        payment_method:    paymentMethod,
                        change_for:        changeFor ?? null,
                        flow_address_done: false,
                    },
                })
                .eq("thread_id", threadId);

            // Salva endereço em enderecos_cliente (com apelido do formulário)
            const customerId = sessionRow.customer_id ?? null;
            if (customerId) {
                const flowApelido     = (context.flow_apelido     as string) ?? "Entrega";
                const flowRua         = (context.flow_rua         as string) ?? address;
                const flowNumero      = (context.flow_numero      as string) ?? null;
                const flowComplemento = (context.flow_complemento as string) ?? null;
                const flowBairro      = (context.flow_bairro_label as string) ?? null;

                const { data: existingAddr } = await admin
                    .from("enderecos_cliente")
                    .select("id")
                    .eq("customer_id", customerId)
                    .eq("company_id", companyId)
                    .eq("apelido", flowApelido)
                    .maybeSingle();

                if (existingAddr?.id) {
                    await admin.from("enderecos_cliente").update({
                        logradouro:   flowRua,
                        numero:       flowNumero,
                        complemento:  flowComplemento,
                        bairro:       flowBairro,
                        is_principal: true,
                    }).eq("id", existingAddr.id);
                } else {
                    await admin.from("enderecos_cliente").insert({
                        company_id:   companyId,
                        customer_id:  customerId,
                        apelido:      flowApelido,
                        logradouro:   flowRua,
                        numero:       flowNumero,
                        complemento:  flowComplemento,
                        bairro:       flowBairro,
                        is_principal: true,
                    });
                }
            }

            // Busca telefone da thread para enviar a confirmação
            const { data: threadRow } = await admin
                .from("whatsapp_threads")
                .select("phone_e164")
                .eq("id", threadId)
                .maybeSingle();

            const phoneE164 = threadRow?.phone_e164 ?? null;

            if (phoneE164) {
                // Monta resumo do pedido
                const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
                const paymentLabel = pmLabels[paymentMethod] ?? paymentMethod;
                const fee          = (context.delivery_fee as number) ?? 0;
                const total        = cart.reduce((s, i) => s + i.price * i.qty, 0) + fee;
                const feeText      = fee > 0 ? `\n🛵 Taxa de entrega: ${formatCurrency(fee)}` : "";
                const changeText   = changeFor ? ` (troco para ${formatCurrency(changeFor)})` : "";

                const summaryText =
                    `📋 *Resumo do pedido:*\n\n` +
                    `${formatCart(cart)}\n` +
                    `${feeText}\n` +
                    `📍 Entrega: ${address}\n` +
                    `💳 Pagamento: ${paymentLabel}${changeText}\n\n` +
                    `💰 *Total: ${formatCurrency(total)}*`;

                await sendWhatsAppMessage(phoneE164, summaryText);
                await sendInteractiveButtons(phoneE164, "Confirmar o pedido?", [
                    { id: "confirmar",     title: "✅ Confirmar pedido" },
                    { id: "change_items",  title: "🔄 Alterar itens" },
                    { id: "change_address", title: "📍 Mudar endereço" },
                ]);
            }

            const response = encryptFlowResponse(
                {
                    version: "3.0",
                    screen:  "SUCCESS",
                    data:    { order_code: "📱 Confira na conversa!" },
                },
                aesKey,
                iv
            );
            return new NextResponse(response, { headers: { "Content-Type": "text/plain" } });
        }

        return encryptedError("unknown_screen", aesKey, iv);
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

// ─── Helper de erro criptografado ─────────────────────────────────────────────

function encryptedError(errorCode: string, aesKey: Buffer, iv: Buffer): NextResponse {
    console.error("[flows] error:", errorCode);
    const body = encryptFlowResponse(
        { version: "3.0", data: { error_message: errorCode } },
        aesKey,
        iv
    );
    return new NextResponse(body, { headers: { "Content-Type": "text/plain" } });
}
