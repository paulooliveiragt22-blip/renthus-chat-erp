"use client";

import React from "react";
import type { DraftQty, Variant } from "@/lib/orders/types";
import { buildVariantTexts, btnPurple, formatBRL, toQtyInt } from "@/lib/orders/helpers";

export default function VariantResultRow({
    v,
    draft,
    onDraftChange,
    onAdd,
}: {
    v: Variant;
    draft: DraftQty;
    onDraftChange: (patch: Partial<DraftQty>) => void;
    onAdd: (unitQty: number, boxQty: number) => void;
}) {
    const { title, sub } = buildVariantTexts(v);
    const unitN = toQtyInt(draft.unit);
    const boxN = toQtyInt(draft.box);
    const canAdd = unitN > 0 || boxN > 0;

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
                    {title}
                </div>
                <div style={{ color: "#555", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
                <div style={{ color: "#111", marginTop: 4, fontSize: 12 }}>
                    Unit: <b>R$ {formatBRL(v.unit_price)}</b>{" "}
                    {v.has_case ? (
                        <>
                            • Caixa: <b>R$ {formatBRL(v.case_price ?? 0)}</b> ({v.case_qty ?? "?"} un)
                        </>
                    ) : null}
                </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 900 }}>Un</label>
                    <input
                        value={draft.unit}
                        onChange={(e) => onDraftChange({ unit: e.target.value })}
                        placeholder="0"
                        inputMode="numeric"
                        style={{ width: 60, padding: 8, borderRadius: 10, border: "1px solid #ccc", fontSize: 12 }}
                    />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 900 }}>Cx</label>
                    <input
                        value={draft.box}
                        onChange={(e) => onDraftChange({ box: e.target.value })}
                        placeholder="0"
                        inputMode="numeric"
                        style={{ width: 60, padding: 8, borderRadius: 10, border: "1px solid #ccc", fontSize: 12 }}
                    />
                </div>

                <button disabled={!canAdd} onClick={() => onAdd(unitN, boxN)} style={btnPurple(!canAdd)}>
                    Adicionar
                </button>
            </div>
        </div>
    );
}
