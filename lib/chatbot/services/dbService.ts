/**
 * lib/chatbot/services/dbService.ts
 *
 * Ponto único de acesso a produtos/preços para uso interno das tools de IA.
 * Sem lógica de negócio — apenas acesso a dados.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";
import { getCachedProducts } from "../TextParserService";
import type { ParsedItem } from "../OrderParserService";

export interface ProductToolResult {
    id: string;
    name: string;
    unitPrice: number;
    available: boolean;
}

/**
 * Busca produtos no catálogo (cache 5min) filtrando por `query`.
 * Usado pelas tools de IA para validar existência antes de confirmar ao cliente.
 */
export async function searchProductsForTool(
    admin: SupabaseClient,
    companyId: string,
    query: string
): Promise<ProductToolResult[]> {
    const products = await getCachedProducts(admin, companyId);
    if (!products.length) return [];

    const fuse = new Fuse(products, {
        keys:         [
            { name: "productName", weight: 0.7 },
            { name: "tags",        weight: 0.2 },
            { name: "searchDesc",  weight: 0.1 },
        ],
        threshold:    0.4,
        includeScore: true,
    });

    return fuse
        .search(query)
        .filter((r) => (r.score ?? 1) < 0.5)
        .slice(0, 5)
        .map((r) => ({
            id:         r.item.id,
            name:       r.item.productName,
            unitPrice:  r.item.unitPrice,
            available:  true,
        }));
}

/**
 * Busca produto por ID exato. Retorna null se não encontrado.
 * Usado para validar itens do carrinho após parse do Claude.
 */
export async function getProductById(
    admin: SupabaseClient,
    companyId: string,
    productId: string
): Promise<{ id: string; name: string; unitPrice: number } | null> {
    const products = await getCachedProducts(admin, companyId);
    const found = products.find((p) => p.id === productId);
    if (!found) return null;
    return { id: found.id, name: found.productName, unitPrice: found.unitPrice };
}

export interface ValidatedItem extends ParsedItem {
    /** Preço real do DB (pode diferir do preço retornado pelo Claude) */
    unitPrice: number;
}

/**
 * Valida cada item do parseWithClaude contra o DB antes de adicionar ao carrinho.
 * - Busca por ID exato; se não encontrado, tenta busca por nome.
 * - Substitui preço pelo valor real do DB.
 * - Retorna valid[] (itens confirmados) e rejected[] (nomes não encontrados).
 */
export async function validateCartItems(
    admin: SupabaseClient,
    companyId: string,
    parsedItems: ParsedItem[]
): Promise<{ valid: ValidatedItem[]; rejected: string[] }> {
    const valid: ValidatedItem[] = [];
    const rejected: string[] = [];

    for (const item of parsedItems) {
        // 1. Busca por ID exato
        const byId = await getProductById(admin, companyId, item.variantId);
        if (byId) {
            valid.push({ ...item, price: byId.unitPrice, unitPrice: byId.unitPrice });
            continue;
        }

        // 2. Fallback: busca por nome via Fuse
        const byName = await searchProductsForTool(admin, companyId, item.name);
        if (byName.length > 0) {
            const best = byName[0];
            valid.push({
                ...item,
                variantId: best.id,
                name:      best.name,
                price:     best.unitPrice,
                unitPrice: best.unitPrice,
            });
        } else {
            rejected.push(item.name);
        }
    }

    return { valid, rejected };
}
