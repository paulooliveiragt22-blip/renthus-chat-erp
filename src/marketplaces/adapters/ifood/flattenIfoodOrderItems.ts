import type { MarketplaceExternalOrderItem } from "@/src/types/contracts.marketplace-orders";

/**
 * Achata itens do pedido iFood + options/complements aninhados em linhas planas.
 */
export function flattenIfoodOrderItems(
    itemsRaw: Array<Record<string, unknown>>
): MarketplaceExternalOrderItem[] {
    const out: MarketplaceExternalOrderItem[] = [];

    for (const it of itemsRaw) {
        const qty = Math.max(1, Math.floor(Number(it.quantity ?? 1)));
        const unitPrice = Number(it.unitPrice ?? it.price ?? 0) || 0;
        out.push({
            externalItemId:
                it.id != null
                    ? String(it.id)
                    : it.externalCode != null
                      ? String(it.externalCode)
                      : null,
            name: String(it.name ?? "Item iFood"),
            quantity: qty,
            unitPrice,
        });

        const nested = [
            ...((it.options as Array<Record<string, unknown>> | undefined) ?? []),
            ...((it.garnishItems as Array<Record<string, unknown>> | undefined) ?? []),
            ...((it.complements as Array<Record<string, unknown>> | undefined) ?? []),
        ];
        for (const opt of nested) {
            const optQty = Math.max(1, Math.floor(Number(opt.quantity ?? qty)));
            out.push({
                externalItemId:
                    opt.id != null
                        ? String(opt.id)
                        : opt.externalCode != null
                          ? String(opt.externalCode)
                          : null,
                name: String(opt.name ?? "Complemento"),
                quantity: optQty,
                unitPrice: Number(opt.unitPrice ?? opt.price ?? opt.addition ?? 0) || 0,
            });
        }
    }

    return out;
}
