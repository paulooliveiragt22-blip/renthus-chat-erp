"use client";

import React from "react";

type PaymentMethod = "pix" | "card" | "cash";

function formatBRL(n: number | null | undefined) {
    const v = typeof n === "number" ? n : 0;
    return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function changeToBring(total: number, changeFor: number | null) {
    const cf = Number(changeFor ?? 0);
    const diff = cf - Number(total ?? 0);
    return diff > 0 ? diff : 0;
}

export default function OrderPaymentInfo({
    payment_method,
    paid,
    total_amount,
    change_for,
}: {
    payment_method: PaymentMethod;
    paid: boolean;
    total_amount: number;
    change_for: number | null;
}) {
    const methodLabel = payment_method === "pix" ? "PIX" : payment_method === "card" ? "Cartão" : "Dinheiro";

    return (
        <div style={{ fontSize: 12, lineHeight: 1.25 }}>
            <div style={{ fontWeight: 900 }}>
                {methodLabel}
                {paid ? " (pago)" : ""}
                {payment_method === "card" ? " • Levar maquininha" : ""}
            </div>

            {payment_method === "cash" ? (
                <>
                    <div style={{ color: "#666", marginTop: 4 }}>Cliente paga com: R$ {formatBRL(change_for ?? 0)}</div>
                    <div style={{ marginTop: 2 }}>
                        <span style={{ color: "#666" }}>Levar de troco:</span>{" "}
                        <b>R$ {formatBRL(changeToBring(total_amount, change_for))}</b>
                    </div>
                </>
            ) : null}
        </div>
    );
}
