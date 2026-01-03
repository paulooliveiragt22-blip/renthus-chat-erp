"use client";

import React from "react";
import { calcTroco, formatBRL } from "@/lib/orders/helpers";
import type { PaymentMethod } from "@/lib/orders/types";

export default function OrderPaymentInfo({
    payment_method,
    paid,
    change_for,
    total_amount,
    compact,
}: {
    payment_method: PaymentMethod | string;
    paid: boolean;
    change_for: number | null;
    total_amount: number | null | undefined;
    compact?: boolean;
}) {
    const pm = String(payment_method) as PaymentMethod | string;
    const label = pm === "pix" ? "PIX" : pm === "card" ? "Cartão" : pm === "cash" ? "Dinheiro" : pm;

    const total = Number(total_amount ?? 0);
    const customerPays = Number(change_for ?? 0);
    const troco = calcTroco(total, customerPays);

    const baseText: React.CSSProperties = { fontSize: compact ? 12 : 12, lineHeight: 1.2 };
    const muted: React.CSSProperties = { ...baseText, color: "#666" };
    const strong: React.CSSProperties = { ...baseText, fontWeight: 900, color: "#111" };

    if (pm === "card") {
        return (
            <div>
                <div style={strong}>
                    {label}
                    {paid ? " (pago)" : ""}
                </div>
                <div style={muted}>Levar maquininha</div>
            </div>
        );
    }

    if (pm === "cash") {
        return (
            <div>
                <div style={strong}>
                    {label}
                    {paid ? " (pago)" : ""}
                </div>
                <div style={muted}>Cliente paga com: R$ {formatBRL(customerPays)}</div>
                <div style={muted}>Levar de troco: R$ {formatBRL(troco)}</div>
            </div>
        );
    }

    return (
        <div>
            <div style={strong}>
                {label}
                {paid ? " (pago)" : ""}
            </div>
        </div>
    );
}
