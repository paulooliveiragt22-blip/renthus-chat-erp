/**
 * Recomendação por "serve até N pessoas" (campo da embalagem).
 * Só devolve linha que está no catálogo. Sem cadastro, não inventa porção.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogOfferPick } from "./catalogOfferFollowUp";
import type { PartySizeRequest } from "./partySizeRequest";

type ServeRow = {
    id: string;
    display_name: string | null;
    product_name: string | null;
    preco_venda: number | string | null;
    serve_ate: number | null;
};

function priceOf(row: ServeRow): number | null {
    const n = Number(row.preco_venda);
    return Number.isFinite(n) ? n : null;
}

function rankForParty(rows: ServeRow[], people: number): ServeRow[] {
    const usable = rows.filter((r) => r.serve_ate != null && r.serve_ate >= 1);
    const above = usable
        .filter((r) => (r.serve_ate ?? 0) >= people)
        .sort((a, b) => (a.serve_ate ?? 0) - (b.serve_ate ?? 0) || (priceOf(a) ?? 0) - (priceOf(b) ?? 0));
    const below = usable
        .filter((r) => (r.serve_ate ?? 0) < people)
        .sort((a, b) => (b.serve_ate ?? 0) - (a.serve_ate ?? 0));
    const seen = new Set<string>();
    const out: ServeRow[] = [];
    for (const row of [...above, ...below]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
        if (out.length >= 3) break;
    }
    return out;
}

export async function loadPartySizeOffers(params: {
    admin: SupabaseClient;
    companyId: string;
    request: PartySizeRequest;
}): Promise<CatalogOfferPick[]> {
    const hint = params.request.productHint?.trim().toLowerCase().replaceAll(/[^a-z0-9]/g, "") || null;
    let query = params.admin
        .from("view_chat_produtos")
        .select("id, display_name, product_name, preco_venda, serve_ate")
        .eq("company_id", params.companyId)
        .not("serve_ate", "is", null);
    if (hint) {
        query = query.or(`product_name.ilike.%${hint}%,display_name.ilike.%${hint}%`);
    }
    const { data, error } = await query.limit(80);
    if (error || !data) return [];
    let rows = data as ServeRow[];
    if (hint) {
        rows = rows.filter((r) => {
            const blob = `${r.product_name ?? ""} ${r.display_name ?? ""}`.toLowerCase();
            return blob.includes(hint);
        });
    }
    return rankForParty(rows, params.request.people).map((r) => ({
        embalagemId: r.id,
        label: (r.display_name || r.product_name || "Item").trim(),
        price: priceOf(r),
        productName: r.product_name,
        serveAte: r.serve_ate,
    }));
}

export function formatPartySizeReply(people: number, offers: readonly (CatalogOfferPick & { serveAte?: number | null })[], productHint: string | null): string {
    if (!offers.length) {
        if (productHint) {
            return `Não tenho cadastrado o que serve ${people} pessoas em "${productHint}". Me diz o tamanho ou o nome que eu busco no cardápio.`;
        }
        return `Ainda não há itens com "serve até N pessoas" no cardápio. Me diz o nome do produto que eu busco.`;
    }
    const lines = offers.map((o, i) => {
        const price = o.price != null ? ` — R$ ${o.price.toFixed(2).replace(".", ",")}` : "";
        const serve = o.serveAte != null ? ` (serve ${o.serveAte})` : "";
        return `${i + 1}. ${o.label}${serve}${price}`;
    });
    const head = productHint
        ? `Para ${people} pessoas, em ${productHint}:`
        : `Para ${people} pessoas, eu indicaria:`;
    const close =
        offers.length === 1
            ? "Responda quero essa para adicionar."
            : "Digite o número da opção.";
    return `${head}\n\n${lines.join("\n")}\n\n${close}`;
}
