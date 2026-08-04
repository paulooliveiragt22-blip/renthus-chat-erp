import type {
    PublicMenuCategory,
    PublicMenuItem,
    PublicMenuResponse,
    PublicMenuResult,
    PublicMenuRpcItemRow,
    PublicMenuRpcPayload,
    PublicMenuRpcStoreRow,
    PublicMenuStore,
} from "@/src/types/contracts.public-menu";
import { parseMenuSlug } from "./slug";

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
    return typeof v === "string" ? v : fallback;
}

function asNullableString(v: unknown): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
}

function asNumber(v: unknown): number {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

function asBool(v: unknown, fallback = true): boolean {
    if (typeof v === "boolean") return v;
    return fallback;
}

function parseStoreRow(raw: unknown): PublicMenuStore | null {
    if (!isRecord(raw)) return null;
    const slugParsed = parseMenuSlug(raw.slug);
    if (!slugParsed.ok) return null;
    const companyId = asString(raw.company_id);
    if (!companyId) return null;
    return {
        companyId,
        slug: slugParsed.slug,
        displayName: asString(raw.display_name, "Cardápio") || "Cardápio",
        tagline: asNullableString(raw.tagline),
        logoUrl: asNullableString(raw.logo_url),
        whatsappPhone: asNullableString(raw.whatsapp_phone),
        city: asNullableString(raw.city),
        state: asNullableString(raw.state),
        isActive: asBool(raw.is_active, true),
    };
}

function parseItemRow(raw: unknown): PublicMenuItem | null {
    if (!isRecord(raw)) return null;
    const embalagemId = asString(raw.embalagem_id);
    const productId = asString(raw.product_id);
    const name = asString(raw.name).trim();
    if (!embalagemId || !productId || !name) return null;
    return {
        embalagemId,
        productId,
        categoryId: asNullableString(raw.category_id),
        categoryName: asNullableString(raw.category_name),
        name,
        description: asNullableString(raw.description),
        price: asNumber(raw.price),
        currency: "BRL",
        sigla: (asNullableString(raw.sigla) ?? "UN").toUpperCase(),
        thumbnailUrl: asNullableString(raw.thumbnail_url),
        imageUrl: asNullableString(raw.image_url),
        inStock: asBool(raw.in_stock, true),
    };
}

function groupCategories(items: PublicMenuItem[], rows: PublicMenuRpcItemRow[]): PublicMenuCategory[] {
    const sortByCat = new Map<string, number>();
    for (const r of rows) {
        const id = r.category_id ?? "__uncategorized__";
        const sort = r.category_sort == null ? 999 : Number(r.category_sort);
        if (!sortByCat.has(id)) sortByCat.set(id, Number.isFinite(sort) ? sort : 999);
    }

    const map = new Map<string, PublicMenuCategory>();
    for (const item of items) {
        const id = item.categoryId ?? "__uncategorized__";
        const name = item.categoryName ?? "Outros";
        let cat = map.get(id);
        if (!cat) {
            cat = {
                id,
                name,
                sortOrder: sortByCat.get(id) ?? 999,
                items: [],
            };
            map.set(id, cat);
        }
        cat.items.push(item);
    }

    return [...map.values()].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, "pt-BR");
    });
}

/** Valida payload do RPC e monta PublicMenuResult tipado. */
export function parsePublicMenuRpcPayload(raw: unknown): PublicMenuResult {
    if (!isRecord(raw)) {
        return { ok: false, error: "menu_not_found" };
    }

    if (raw.error === "menu_not_found") {
        return { ok: false, error: "menu_not_found" };
    }
    if (raw.error === "menu_inactive") {
        return { ok: false, error: "menu_inactive" };
    }

    const store = parseStoreRow(raw.store);
    if (!store) return { ok: false, error: "menu_not_found" };
    if (!store.isActive) return { ok: false, error: "menu_inactive" };

    const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
    const itemRows: PublicMenuRpcItemRow[] = [];
    const items: PublicMenuItem[] = [];
    for (const row of itemsRaw) {
        const item = parseItemRow(row);
        if (!item) continue;
        items.push(item);
        if (isRecord(row)) {
            itemRows.push({
                embalagem_id: item.embalagemId,
                product_id: item.productId,
                category_id: item.categoryId,
                category_name: item.categoryName,
                name: item.name,
                description: item.description,
                price: item.price,
                sigla: item.sigla,
                thumbnail_url: item.thumbnailUrl,
                image_url: item.imageUrl,
                in_stock: item.inStock,
                category_sort: typeof row.category_sort === "number" ? row.category_sort : null,
            });
        }
    }

    const menu: PublicMenuResponse = {
        store,
        categories: groupCategories(items, itemRows),
        itemCount: items.length,
        generatedAt: new Date().toISOString(),
    };

    return { ok: true, menu };
}

/** Type guard útil em testes / callers. */
export function assertPublicMenuRpcShape(raw: unknown): raw is PublicMenuRpcPayload {
    if (!isRecord(raw) || !isRecord(raw.store) || !Array.isArray(raw.items)) return false;
    return typeof raw.store.company_id === "string" && typeof raw.store.slug === "string";
}
