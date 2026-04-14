/** Payload de itens para `rpc_admin_upsert_order_with_items` (JSON serializável). */
export type RpcAdminOrderItem = {
    product_name: string;
    produto_embalagem_id: string | null;
    quantity: number;
    unit_price: number;
    unit_type: string;
};

export function orderItemsForAdminRpc(items: Array<Record<string, unknown>>): RpcAdminOrderItem[] {
    return items.map((raw) => {
        const embRaw = raw.produto_embalagem_id;
        const emb =
            embRaw != null && String(embRaw).trim() !== "" ? String(embRaw).trim() : null;
        const qty = Math.max(1, Number(raw.quantity ?? raw.qty ?? 1));
        return {
            product_name: String(raw.product_name ?? ""),
            produto_embalagem_id: emb,
            quantity: qty,
            unit_price: Number(raw.unit_price ?? 0),
            unit_type: String(raw.unit_type ?? "unit") || "unit",
        };
    });
}
