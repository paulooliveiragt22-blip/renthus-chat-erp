/**
 * Extração estruturada de pedido (cutover LLM).
 * Só termo de busca + quantidade (+ pagamento/endereço/swap).
 * Nunca ID de embalagem, preço ou nome canónico de catálogo.
 */

import { z } from "zod";

export const OrderLineExtractionItemSchema = z.object({
    searchTerm: z.string().trim().min(1).max(120),
    quantity: z.number().positive().max(999),
});

export const OrderLineSwapSchema = z.object({
    removeName: z.string().trim().min(1).max(80),
    replaceSearchTerm: z.string().trim().min(1).max(120),
    replaceHint: z.string().trim().max(80).optional(),
});

export const OrderLineExtractionSchema = z
    .object({
        v: z.literal(1),
        items: z.array(OrderLineExtractionItemSchema).max(8),
        paymentMethod: z.enum(["pix", "cash", "card"]).nullable().optional(),
        useSavedAddress: z.boolean().optional(),
        addressRaw: z.string().trim().max(300).nullable().optional(),
        swap: OrderLineSwapSchema.nullable().optional(),
    })
    .refine((d) => d.items.length > 0 || (d.swap != null && d.swap.removeName.length > 0), {
        message: "items ou swap obrigatório",
    });

export type OrderLineExtraction = z.infer<typeof OrderLineExtractionSchema>;
export type OrderLineExtractionItem = z.infer<typeof OrderLineExtractionItemSchema>;
export type OrderLineSwap = z.infer<typeof OrderLineSwapSchema>;

/** Intent de troca derivado da extração (servidor monta searchQuery). */
export type CheckoutSwapIntent = {
    removeName: string;
    searchQuery: string;
    replaceHint: string;
};

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
    if (!Array.isArray(itemsRaw) && o.swap == null && o.troca == null) return null;

    const items: Array<{ searchTerm: string; quantity: number }> = [];
    if (Array.isArray(itemsRaw)) {
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

    let swap: OrderLineSwap | null | undefined;
    const swapRaw = o.swap ?? o.troca;
    if (swapRaw && typeof swapRaw === "object") {
        const s = swapRaw as Record<string, unknown>;
        const removeName = String(
            s.removeName ?? s.remove_name ?? s.remover ?? s.from ?? ""
        ).trim();
        const replaceSearchTerm = String(
            s.replaceSearchTerm ??
                s.replace_search_term ??
                s.replaceHint ??
                s.replace_hint ??
                s.por ??
                s.to ??
                ""
        ).trim();
        const replaceHint = String(s.replaceHint ?? s.replace_hint ?? replaceSearchTerm)
            .trim()
            .slice(0, 80);
        if (removeName && replaceSearchTerm) {
            swap = {
                removeName: removeName.slice(0, 80),
                replaceSearchTerm: replaceSearchTerm.slice(0, 120),
                replaceHint: replaceHint || undefined,
            };
        }
    } else if (swapRaw === null) {
        swap = null;
    }

    const parsed = OrderLineExtractionSchema.safeParse({
        v: 1,
        items: items.slice(0, 8),
        paymentMethod,
        useSavedAddress: useSaved || undefined,
        addressRaw: addressRaw ?? null,
        swap: swap ?? null,
    });
    return parsed.success ? parsed.data : null;
}
