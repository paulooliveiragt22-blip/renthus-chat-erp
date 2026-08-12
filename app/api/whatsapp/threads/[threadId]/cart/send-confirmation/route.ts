import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { loadWaConfigForCompany } from "@/lib/whatsapp/channelCredentials";
import { sendAndPersistWaText } from "@/lib/whatsapp/sendAndPersist";
import { formatEnderecoLine } from "@/lib/orders/helpers";
import { validateDraftConsistency } from "@/src/pro/adapters/order/order.service.v2";
import type { DraftAddress, DraftItem, OrderDraft, PaymentMethod } from "@/src/types/contracts";
import { jsonAccessError, jsonError, jsonInternalError } from "@/lib/api/errors";

export const runtime = "nodejs";

type BodyItem = { produtoEmbalagemId: string; productName: string; quantity: number; unitPrice: number };
type BodyAddress = {
    logradouro: string;
    numero: string;
    complemento?: string | null;
    bairro: string;
    cidade: string;
    estado: string;
    cep?: string | null;
};
type Body = {
    items: BodyItem[];
    address: BodyAddress;
    paymentMethod: PaymentMethod;
    changeFor?: number | null;
    deliveryFee?: number;
};

function asMoney(n: unknown): number {
    return Number((Number(n) || 0).toFixed(2));
}

function buildSummaryText(params: { items: BodyItem[]; address: DraftAddress; paymentMethod: PaymentMethod; deliveryFee: number; grandTotal: number }): string {
    const { items, address, paymentMethod, deliveryFee, grandTotal } = params;
    const paymentLabel = paymentMethod === "pix" ? "PIX" : paymentMethod === "card" ? "Cartão" : "Dinheiro";
    const lines = items.map((it) => `• ${it.quantity}x ${it.productName} — R$ ${asMoney(it.quantity * it.unitPrice).toFixed(2).replace(".", ",")}`);
    const parts = [
        "Confere seu pedido pra eu finalizar:",
        ...lines,
        deliveryFee > 0 ? `Taxa de entrega: R$ ${deliveryFee.toFixed(2).replace(".", ",")}` : null,
        `Total: R$ ${grandTotal.toFixed(2).replace(".", ",")}`,
        `Pagamento: ${paymentLabel}`,
        `Entrega: ${formatEnderecoLine(address)}`,
        "",
        "Responda *CONFIRMAR* para fechar o pedido ou *CANCELAR* para não fechar agora.",
    ].filter(Boolean);
    return parts.join("\n");
}

/**
 * POST /api/whatsapp/threads/:threadId/cart/send-confirmation
 *
 * Atendente monta/edita o carrinho (itens, endereço, pagamento) no
 * `CartEditModal` e pede confirmação do cliente pelo WhatsApp. Não cria o
 * pedido agora — só grava o rascunho em `whatsapp_order_confirmations`
 * (status pending) e envia a mensagem determinística de confirmação. O
 * pedido só é criado quando o cliente responder CONFIRMAR (ver
 * `resolvePendingOrderConfirmation.ts`, plugado em process-queue).
 */
export async function POST(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
    const { threadId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return jsonAccessError(ctx);
    const { admin, companyId, userId } = ctx;

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
        return jsonError("items_required", "Adicione ao menos um item ao carrinho.", 400);
    }
    if (!body.paymentMethod || !["pix", "cash", "card"].includes(body.paymentMethod)) {
        return jsonError("invalid_payment_method", "Selecione uma forma de pagamento válida.", 400);
    }
    const addr = body.address;
    if (!addr?.logradouro?.trim() || !addr?.numero?.trim() || !addr?.bairro?.trim() || !addr?.cidade?.trim() || !addr?.estado?.trim() || addr.estado.trim().length < 2) {
        return jsonError("invalid_address", "Preencha o endereço completo (rua, número, bairro, cidade e estado).", 400);
    }

    const { data: thread, error: threadErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, profile_name, bot_active")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (threadErr) return jsonInternalError(threadErr, { route: "whatsapp/threads/:id/cart/send-confirmation:POST" });
    if (!thread?.phone_e164) return jsonError("thread_not_found", "Conversa não encontrada.", 404);

    const items: DraftItem[] = body.items.map((it) => ({
        produtoEmbalagemId: String(it.produtoEmbalagemId),
        productName: String(it.productName),
        quantity: Math.max(1, Number(it.quantity) || 0),
        unitPrice: asMoney(it.unitPrice),
        fatorConversao: 1,
        productVolumeId: null,
        estoqueUnidades: 0,
    }));

    const address: DraftAddress = {
        logradouro: addr.logradouro.trim(),
        numero: addr.numero.trim(),
        bairro: addr.bairro.trim(),
        complemento: addr.complemento?.trim() || null,
        cidade: addr.cidade.trim(),
        estado: addr.estado.trim().toUpperCase(),
        cep: addr.cep?.trim() || null,
        apelido: "WhatsApp",
    };

    const totalItems = asMoney(items.reduce((s, it) => s + it.quantity * it.unitPrice, 0));
    const deliveryFee = asMoney(body.deliveryFee ?? 0);
    const grandTotal = asMoney(totalItems + deliveryFee);

    const draft: OrderDraft = {
        items,
        address,
        paymentMethod: body.paymentMethod,
        changeFor: body.paymentMethod === "cash" && body.changeFor != null ? asMoney(body.changeFor) : null,
        deliveryFee,
        deliveryZoneId: null,
        deliveryAddressText: formatEnderecoLine(address),
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems,
        grandTotal,
        pendingConfirmation: false,
        version: 1,
    };

    const consistency = validateDraftConsistency(draft);
    if (!consistency.ok) {
        return jsonError("inconsistent_draft", consistency.message, 400);
    }

    const customer = await getOrCreateCustomer(admin, companyId, thread.phone_e164 as string, thread.profile_name as string | null);

    // No máximo 1 confirmação em aberto por thread — supersede qualquer pendência anterior.
    await admin
        .from("whatsapp_order_confirmations")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("thread_id", threadId)
        .eq("status", "pending");

    const summaryText = buildSummaryText({ items: body.items, address, paymentMethod: body.paymentMethod, deliveryFee, grandTotal });

    const { data: inserted, error: insertErr } = await admin
        .from("whatsapp_order_confirmations")
        .insert({
            company_id: companyId,
            thread_id: threadId,
            customer_id: customer?.id ?? null,
            draft,
            summary_text: summaryText,
            status: "pending",
            created_by: userId,
        })
        .select("id")
        .single();
    if (insertErr || !inserted?.id) {
        return jsonInternalError(insertErr ?? new Error("failed_to_create_confirmation"), {
            route: "whatsapp/threads/:id/cart/send-confirmation:POST",
            step: "insert_confirmation",
        });
    }

    /**
     * Desliga o bot enquanto aguarda a confirmação: o interceptor determinístico
     * (resolvePendingOrderConfirmation) já funciona independente do bot_active, mas deixar o
     * bot ativo permitiria ele responder/agir sobre qualquer outra coisa que o cliente mande
     * nesse meio-tempo, competindo com o atendente que assumiu o fechamento deste pedido.
     */
    if (thread.bot_active !== false) {
        await admin
            .from("whatsapp_threads")
            .update({ bot_active: false, handover_at: new Date().toISOString() })
            .eq("id", threadId);
    }

    const waConfig = await loadWaConfigForCompany(admin, companyId);
    const sendResult = await sendAndPersistWaText(admin, {
        threadId,
        phoneE164: thread.phone_e164 as string,
        text: summaryText,
        waConfig,
        senderType: "human",
    });

    if (!sendResult.ok) {
        return jsonError(
            "whatsapp_send_failed",
            sendResult.error || "Falha ao enviar a confirmação pelo WhatsApp.",
            502,
            { confirmationId: inserted.id }
        );
    }

    return NextResponse.json({ ok: true, confirmationId: inserted.id, summaryText });
}
