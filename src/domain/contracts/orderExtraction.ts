import { z } from "zod";

/**
 * Fase 2 — extração estruturada (sombra → cutover).
 * Só termo de busca + quantidade (+ hints de pagamento/endereço).
 * Nunca ID de embalagem, preço ou nome canónico de catálogo.
 */
export const OrderLineExtractionItemSchema = z.object({
    searchTerm: z.string().trim().min(1).max(120),
    quantity: z.number().positive().max(999),
});

export const OrderLineExtractionSchema = z.object({
    v: z.literal(1),
    items: z.array(OrderLineExtractionItemSchema).max(8),
    paymentMethod: z.enum(["pix", "cash", "card"]).nullable().optional(),
    useSavedAddress: z.boolean().optional(),
    addressRaw: z.string().trim().max(300).nullable().optional(),
});

export type OrderLineExtraction = z.infer<typeof OrderLineExtractionSchema>;
export type OrderLineExtractionItem = z.infer<typeof OrderLineExtractionItemSchema>;

/** Aceita JSON cru do modelo (snake_case ou camelCase) → contrato. */
export function parseOrderLineExtractionJson(raw: unknown): OrderLineExtraction | null {
    let value: unknown = raw;
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const body = fence?.[1]?.trim() || trimmed;
        try {
            value = JSON.parse(body);
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== "object") return null;
    const o = value as Record<string, unknown>;
    const itemsRaw = o.items ?? o.itens;
    if (!Array.isArray(itemsRaw)) return null;

    const items: Array<{ searchTerm: string; quantity: number }> = [];
    for (const row of itemsRaw) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const term = String(
            r.searchTerm ?? r.search_term ?? r.term ?? r.query ?? r.produto ?? ""
        ).trim();
        const qty = Number(r.quantity ?? r.qty ?? r.quantidade ?? 1);
        if (!term || !Number.isFinite(qty) || qty <= 0) continue;
        items.push({ searchTerm: term.slice(0, 120), quantity: Math.min(qty, 999) });
    }

    const payRaw = String(o.paymentMethod ?? o.payment_method ?? "").toLowerCase();
    let paymentMethod: "pix" | "cash" | "card" | null | undefined;
    if (payRaw === "pix" || payRaw === "cash" || payRaw === "card") paymentMethod = payRaw;
    else if (payRaw === "" || payRaw === "null") paymentMethod = null;

    const useSaved =
        o.useSavedAddress === true ||
        o.use_saved_address === true ||
        o.mesmo_endereco === true;

    let addressRaw: string | null | undefined;
    if (o.addressRaw != null) addressRaw = String(o.addressRaw).slice(0, 300);
    else if (o.address_raw != null) addressRaw = String(o.address_raw).slice(0, 300);

    const parsed = OrderLineExtractionSchema.safeParse({
        v: 1,
        items: items.slice(0, 8),
        paymentMethod,
        useSavedAddress: useSaved || undefined,
        addressRaw: addressRaw ?? null,
    });
    return parsed.success ? parsed.data : null;
}
