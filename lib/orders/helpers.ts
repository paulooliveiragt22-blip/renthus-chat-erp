import type { CartItem, UnitType, Variant } from "./types";

export const PURPLE = "#3B246B";
export const ORANGE = "#FF6600";

export function formatBRL(n: number | null | undefined) {
    const v = typeof n === "number" ? n : 0;
    return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatBRLInput(raw: string) {
    const digits = raw.replace(/\D/g, "");
    const num = Number(digits) / 100;
    return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function brlToNumber(v: string) {
    const cleaned = v.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
}

export function formatDT(ts: string) {
    try {
        return new Date(ts).toLocaleString("pt-BR");
    } catch {
        return ts;
    }
}

export function prettyStatus(s: string) {
    if (s === "new") return "Novo";
    if (s === "canceled") return "Cancelado";
    if (s === "delivered") return "Entregue";
    if (s === "finalized") return "Finalizado";
    return s;
}

export function statusColor(s: string) {
    if (s === "new") return "green";
    if (s === "canceled") return "crimson";
    if (s === "finalized") return "dodgerblue";
    if (s === "delivered") return "#666";
    return "#333";
}

export function statusBadgeStyle(s: string): React.CSSProperties {
    const c = statusColor(s);
    return {
        display: "inline-block",
        padding: "4px 8px",
        borderRadius: 999,
        fontWeight: 900,
        border: `1px solid ${c}`,
        color: c,
        background: "rgba(0,0,0,0.02)",
        lineHeight: 1,
        fontSize: 12,
        whiteSpace: "nowrap",
    };
}

export function btnBaseSlim(disabled?: boolean): React.CSSProperties {
    return {
        padding: "6px 9px",
        borderRadius: 10,
        border: "1px solid #999",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
    };
}
export function btnPurple(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${PURPLE}`,
        background: disabled ? "#f5f1fb" : PURPLE,
        color: disabled ? PURPLE : "#fff",
    };
}
export function btnPurpleOutline(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${PURPLE}`,
        background: "transparent",
        color: PURPLE,
    };
}

/* botões laranja */
export function btnOrange(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${ORANGE}`,
        background: disabled ? "#fff4ee" : ORANGE,
        color: disabled ? ORANGE : "#fff",
    };
}
export function btnOrangeOutline(disabled?: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(disabled),
        border: `1px solid ${ORANGE}`,
        background: "transparent",
        color: ORANGE,
    };
}

export function chip(active: boolean): React.CSSProperties {
    return {
        ...btnBaseSlim(false),
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? PURPLE : "#ddd"}`,
        background: active ? "#f5f1fb" : "#fff",
        color: active ? PURPLE : "#333",
    };
}

export function escapeHtml(s: string) {
    return (s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function calcTroco(total: number, customerPays: number) {
    const t = Number.isFinite(total) ? total : 0;
    const p = Number.isFinite(customerPays) ? customerPays : 0;
    return Math.max(0, p - t);
}

export function labelUnit(u?: UnitType | null) {
    const val = String(u ?? "none");
    if (val === "none") return "";
    if (val === "l") return "L";
    if (val === "ml") return "ml";
    if (val === "kg") return "kg";
    if (val === "g") return "g";
    if (val === "un") return "un";
    return val;
}

export function buildVariantTexts(v: Variant) {
    const cat = v.products?.categories?.name ?? "";
    const brand = v.products?.brands?.name ?? "";
    const vol = v.volume_value != null ? `${v.volume_value}${labelUnit(v.unit)}` : "";
    const title = `${cat} • ${brand}`.trim();
    const sub = [v.details ?? "", vol].filter(Boolean).join(" • ");
    const displayName = [cat, brand, v.details ?? "", vol].filter(Boolean).join(" • ").trim();
    return { cat, brand, vol, title: title || "Produto", sub: sub || "-", displayName: displayName || "Produto" };
}

export function toQtyInt(v: string) {
    const n = parseInt((v ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
}

export function cartSubtotal(list: CartItem[]) {
    return list.reduce((sum, item) => sum + item.qty * item.price, 0);
}
export function cartTotalPreview(list: CartItem[], feeEnabled: boolean, feeStr: string) {
    const fee = brlToNumber(feeStr);
    return cartSubtotal(list) + (feeEnabled ? fee : 0);
}

/** ✅ INSERT PAYLOAD (sem line_total) */
export type InsertOrderItem = {
    order_id: string;
    product_variant_id: string | null;
    product_name: string | null;
    quantity: number;
    unit_price: number;
    unit_type?: string | null;
    qty?: number;
};
export function buildItemsPayload(orderId: string, list: CartItem[]): InsertOrderItem[] {
    return list.map((item) => {
        const qItem = Math.max(1, Number(item.qty) || 0);
        const price = Number(item.price ?? 0);
        const name = buildVariantTexts(item.variant).displayName;

        return {
            order_id: orderId,
            product_variant_id: item.variant.id,
            product_name: name,
            quantity: qItem,
            unit_price: price,
            unit_type: item.mode === "unit" ? "unit" : item.mode === "case" ? "case" : null,
            qty: qItem,
        };
    });
}
