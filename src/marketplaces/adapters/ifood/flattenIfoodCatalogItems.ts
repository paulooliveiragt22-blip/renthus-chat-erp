import type {
    MarketplaceCatalogItem,
    MarketplaceCatalogOptionGroup,
} from "@/src/types/contracts.marketplace";

function numPrice(v: unknown): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v && typeof v === "object" && "value" in v) {
        const n = Number((v as { value?: unknown }).value);
        return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Achata item iFood (categoria) + optionGroups/options em itens Renthus.
 * Complementos saem com isComplement=true e showOnMenu=false.
 */
export function flattenIfoodCatalogItem(
    it: Record<string, unknown>,
    categoryName: string,
    categoryId: string | null
): MarketplaceCatalogItem[] {
    const products = (it.products as Array<Record<string, unknown>> | undefined) ?? [];
    const productName =
        String(products[0]?.name ?? it.name ?? it.externalCode ?? "Item iFood").trim() ||
        "Item iFood";
    const priceObj = it.price as { value?: number } | number | undefined;
    const price =
        typeof priceObj === "number"
            ? priceObj
            : numPrice(priceObj ?? it.unitPrice ?? 0);
    const imageUrl =
        (products[0]?.imagePath as string | undefined) ??
        (it.imagePath as string | undefined) ??
        (it.imageUrl as string | undefined) ??
        null;
    const parentExternalItemId = String(
        it.id ?? it.externalCode ?? `${categoryId ?? "cat"}-${productName}`
    );

    const parent: MarketplaceCatalogItem = {
        provider: "ifood",
        externalItemId: parentExternalItemId,
        externalProductId: products[0]?.id != null ? String(products[0].id) : null,
        externalCategoryId: categoryId,
        categoryName,
        name: productName,
        description:
            (products[0]?.description as string | null | undefined) ??
            (it.description as string | null | undefined) ??
            null,
        price,
        currency: "BRL",
        imageUrl,
        available: String(it.status ?? "AVAILABLE").toUpperCase() !== "UNAVAILABLE",
        externalCode: (it.externalCode as string | null | undefined) ?? null,
        isComplement: false,
        showOnMenu: true,
        optionGroups: [],
    };

    const out: MarketplaceCatalogItem[] = [parent];
    const groups: MarketplaceCatalogOptionGroup[] = [];
    const ogRaw = (it.optionGroups ??
        it.option_groups ??
        products[0]?.optionGroups ??
        []) as Array<Record<string, unknown>>;

    for (const g of ogRaw) {
        const options = (g.options ?? g.optionItems ?? []) as Array<Record<string, unknown>>;
        const optionExternalIds: string[] = [];
        for (const opt of options) {
            const optName = String(opt.name ?? opt.externalCode ?? "").trim();
            const optId = String(opt.id ?? opt.externalCode ?? "");
            if (!optId || !optName) continue;
            optionExternalIds.push(optId);
            out.push({
                provider: "ifood",
                externalItemId: optId,
                externalProductId: opt.productId != null ? String(opt.productId) : null,
                externalCategoryId: categoryId,
                categoryName: `${categoryName} · Complementos`,
                name: optName,
                description: (opt.description as string | null | undefined) ?? null,
                price: numPrice(opt.price ?? opt.additionalPrice ?? opt.unitPrice ?? 0),
                currency: "BRL",
                imageUrl: (opt.imagePath as string | undefined) ?? null,
                available: String(opt.status ?? "AVAILABLE").toUpperCase() !== "UNAVAILABLE",
                externalCode: (opt.externalCode as string | null | undefined) ?? null,
                isComplement: true,
                parentExternalItemId,
                showOnMenu: false,
            });
        }
        if (optionExternalIds.length === 0) continue;
        groups.push({
            externalGroupId: String(g.id ?? g.name ?? `grp-${groups.length + 1}`),
            name: String(g.name ?? "Opções").trim() || "Opções",
            min: Math.max(0, Math.floor(Number(g.min ?? g.minimum ?? 0)) || 0),
            max: Math.max(1, Math.floor(Number(g.max ?? g.maximum ?? optionExternalIds.length)) || 1),
            optionExternalIds,
        });
    }

    parent.optionGroups = groups;
    return out;
}

/** Aceita pai com preço > 0; complementos podem ser grátis (price >= 0). */
export function isSyncableCatalogItem(item: MarketplaceCatalogItem): boolean {
    if (!item.name?.trim() || !item.externalItemId) return false;
    if (item.isComplement) return item.price >= 0;
    return item.price > 0;
}
