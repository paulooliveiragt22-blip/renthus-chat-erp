"use client";

import React from "react";
import type { CartItem } from "@/lib/orders/types";
import { buildVariantTexts, btnPurpleOutline, formatBRL } from "@/lib/orders/helpers";

export default function CartRow({
    item,
    onDec,
    onInc,
    onRemove,
}: {
    item: CartItem;
    onDec: () => void;
    onInc: () => void;
    onRemove: () => void;
}) {
    const { title, sub } = buildVariantTexts(item.variant);

    return (
        <div
            style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 10,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
            }}
        >
            <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {title} — {item.mode === "unit" ? "Unit" : "Caixa"}
                </div>
                <div style={{ color: "#555", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
                <div style={{ marginTop: 4, fontSize: 12 }}>
                    <b>{item.qty}</b> × <b>R$ {formatBRL(item.price)}</b> = <b>R$ {formatBRL(item.qty * item.price)}</b>
                </div>
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={onDec} style={btnPurpleOutline(false)}>
                    -
                </button>
                <button onClick={onInc} style={btnPurpleOutline(false)}>
                    +
                </button>
                <button onClick={onRemove} style={btnPurpleOutline(false)}>
                    Remover
                </button>
            </div>
        </div>
    );
}
