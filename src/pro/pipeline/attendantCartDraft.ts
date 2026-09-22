/**
 * Draft do carrinho montado pelo atendente (inbox).
 * Usado por send-confirmation (HITL) e finalize (manual).
 */

import { formatEnderecoLine } from "@/lib/orders/helpers";
import { validateDraftConsistency } from "@/src/pro/adapters/order/order.service.v2";
import type { DraftAddress, DraftItem, OrderDraft, PaymentMethod } from "@/src/types/contracts";

export type AttendantCartBodyItem = {
    produtoEmbalagemId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
};

export type AttendantCartBodyAddress = {
    logradouro: string;
    numero: string;
    complemento?: string | null;
    bairro: string;
    cidade: string;
    estado: string;
    cep?: string | null;
};

export type AttendantCartBody = {
    items: AttendantCartBodyItem[];
    address: AttendantCartBodyAddress;
    paymentMethod: PaymentMethod;
    changeFor?: number | null;
    deliveryFee?: number;
};

export function asMoney(n: unknown): number {
    return Number((Number(n) || 0).toFixed(2));
}

export type ParseAttendantCartResult =
    | {
        ok: true;
        draft: OrderDraft;
        items: AttendantCartBodyItem[];
        address: DraftAddress;
        paymentMethod: PaymentMethod;
    }
    | { ok: false; code: string; message: string };

export function parseAttendantCartBody(body: unknown): ParseAttendantCartResult {
    const raw = body as AttendantCartBody | null;
    if (!raw || !Array.isArray(raw.items) || raw.items.length === 0) {
        return { ok: false, code: "items_required", message: "Adicione ao menos um item ao carrinho." };
    }
    if (!raw.paymentMethod || !["pix", "cash", "card"].includes(raw.paymentMethod)) {
        return {
            ok: false,
            code: "invalid_payment_method",
            message: "Selecione uma forma de pagamento válida.",
        };
    }
    const addr = raw.address;
    if (
        !addr?.logradouro?.trim() ||
        !addr?.numero?.trim() ||
        !addr?.bairro?.trim() ||
        !addr?.cidade?.trim() ||
        !addr?.estado?.trim() ||
        addr.estado.trim().length < 2
    ) {
        return {
            ok: false,
            code: "invalid_address",
            message: "Preencha o endereço completo (rua, número, bairro, cidade e estado).",
        };
    }

    const items: DraftItem[] = raw.items.map((it) => ({
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
    const deliveryFee = asMoney(raw.deliveryFee ?? 0);
    const grandTotal = asMoney(totalItems + deliveryFee);

    const draft: OrderDraft = {
        items,
        address,
        paymentMethod: raw.paymentMethod,
        changeFor:
            raw.paymentMethod === "cash" && raw.changeFor != null ? asMoney(raw.changeFor) : null,
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
        return { ok: false, code: "inconsistent_draft", message: consistency.message };
    }

    return { ok: true, draft, items: raw.items, address, paymentMethod: raw.paymentMethod };
}

export function buildHitlSummaryText(params: {
    items: AttendantCartBodyItem[];
    address: DraftAddress;
    paymentMethod: PaymentMethod;
    deliveryFee: number;
    grandTotal: number;
}): string {
    const { items, address, paymentMethod, deliveryFee, grandTotal } = params;
    const paymentLabel =
        paymentMethod === "pix" ? "PIX" : paymentMethod === "card" ? "Cartão" : "Dinheiro";
    const lines = items.map(
        (it) =>
            `• ${it.quantity}x ${it.productName} — R$ ${asMoney(it.quantity * it.unitPrice)
                .toFixed(2)
                .replace(".", ",")}`
    );
    const parts = [
        "Confere seu pedido pra eu finalizar:",
        ...lines,
        deliveryFee > 0
            ? `Taxa de entrega: R$ ${deliveryFee.toFixed(2).replace(".", ",")}`
            : null,
        `Total: R$ ${grandTotal.toFixed(2).replace(".", ",")}`,
        `Pagamento: ${paymentLabel}`,
        `Entrega: ${formatEnderecoLine(address)}`,
        "",
        "Toque em *Confirmar* ou *Cancelar* nos botões abaixo.",
    ].filter(Boolean);
    return parts.join("\n");
}

export function attendantFinalizeIdempotencyKey(
    threadId: string,
    userId: string,
    draft: OrderDraft
): string {
    const fingerprint = draft.items
        .map((it) => `${it.produtoEmbalagemId}:${it.quantity}:${it.unitPrice}`)
        .join("|");
    return `attendant_cart_finalize:${threadId}:${userId}:${fingerprint}:${draft.grandTotal}:${draft.paymentMethod}`;
}
