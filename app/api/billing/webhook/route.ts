/**
 * POST /api/billing/webhook
 *
 * Webhook do Pagar.me — recebe eventos de pagamento.
 *
 * Eventos tratados:
 *   order.paid          → se setup_payment: ativa trial
 *                       → se invoice:       marca paga + ativa/reativa subscription
 *   order.payment_failed → registra falha
 *
 * Variáveis de ambiente:
 *   PAGARME_WEBHOOK_SECRET — segredo configurado no painel Pagar.me (opcional em dev)
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature, extractOrderCustomerId, type PagarmeOrder } from "@/lib/billing/pagarme";
import { processSetupOrderPaid } from "@/lib/billing/pagarmeSetupPaid";
import { applyMonthlyInvoicePaid } from "@/lib/billing/applyMonthlyInvoicePaid";

export const runtime = "nodejs";

// Pagar.me não envia autenticação de rota — usa assinatura HMAC no body
export async function POST(req: Request) {
    const rawBody  = await req.text();
    const signature = (req as any).headers?.get?.("x-hub-signature") ?? "";

    // Verifica assinatura (ignora em dev se PAGARME_WEBHOOK_SECRET não estiver setado)
    const valid = await verifyWebhookSignature(rawBody, signature.replace("sha256=", ""));
    if (!valid) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const eventType: string = event?.type ?? "";
    const data              = event?.data ?? {};

    console.log(`[webhook/pagarme] Evento: ${eventType} | Order: ${data?.id}`);

    const admin = createAdminClient();

    try {
        switch (eventType) {
            case "order.paid":
                await handleOrderPaid(admin, data);
                break;

            // Alguns ambientes enviam confirmação só em charge.* — o pedido vem em data.order
            case "charge.paid": {
                const d    = data as Record<string, unknown>;
                const ord  = (d?.order ?? {}) as { id?: string; metadata?: Record<string, string> };
                const oid  = (typeof ord?.id === "string" && ord.id) ? ord.id : (d?.order_id as string | undefined);
                if (oid) {
                    await handleOrderPaid(admin, {
                        id:       oid,
                        metadata: (ord?.metadata ?? d?.metadata ?? {}) as Record<string, string>,
                        customer: (d?.customer ?? (ord as { customer?: unknown }).customer) as unknown,
                    });
                } else {
                    console.warn("[webhook/pagarme] charge.paid sem id do pedido (order.id / order_id)");
                }
                break;
            }

            case "order.payment_failed":
            case "charge.failed":
                await handleOrderFailed(admin, data);
                break;

            default:
                console.log(`[webhook/pagarme] Evento ignorado: ${eventType}`);
        }
    } catch (err: any) {
        console.error("[webhook/pagarme] Erro:", err?.message ?? err);
        // Retorna 200 para o Pagar.me não fazer retry em erros de negócio
        return NextResponse.json({ ok: false, error: err?.message ?? "Erro interno" });
    }

    return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleOrderPaid(
    admin: ReturnType<typeof createAdminClient>,
    order: any
) {
    const orderId = order?.id as string;
    if (!orderId) {
        console.warn("[webhook/pagarme] order.paid sem order.id");
        return;
    }

    const metadata = (order?.metadata ?? {}) as Record<string, string>;
    const metaType = metadata?.type as string | undefined;

    // ── 1) Setup: localizar SEMPRE por pagarme_order_id.
    if (await processSetupOrderPaid(admin, order)) {
        return;
    }

    if (metaType === "setup") {
        console.warn(
            "[webhook/pagarme] metadata.type=setup mas nenhuma linha em setup_payments para pagarme_order_id:",
            orderId
        );
        return;
    }

    // ── 2) Invoice: metadata pode faltar — localiza por pagarme_order_id em invoices
    if (metaType === "invoice" || metaType === undefined) {
        const custId = extractOrderCustomerId(order as PagarmeOrder);
        const r      = await applyMonthlyInvoicePaid(admin, orderId, { pagarmeCustomerId: custId });

        if (r.ok) return;

        if (metaType === "invoice") {
            console.warn("[webhook/pagarme] metadata.type=invoice mas invoice não encontrada para order:", orderId);
        } else {
            console.warn(
                "[webhook/pagarme] order.paid sem setup_payment nem invoice para order:",
                orderId,
                "| metadata.type=",
                metaType ?? "(vazio)"
            );
        }
    }
}

async function handleOrderFailed(
    admin: ReturnType<typeof createAdminClient>,
    order: any
) {
    const orderId = order?.id as string;
    if (!orderId) return;

    // Atualiza invoice com status failed (se encontrada)
    await admin
        .from("invoices")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    // Atualiza setup_payment (se for setup)
    await admin
        .from("setup_payments")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    console.log(`[webhook/pagarme] Pagamento falhou para order: ${orderId}`);
}

