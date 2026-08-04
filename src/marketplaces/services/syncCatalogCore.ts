import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    MarketplaceCatalogItem,
    MarketplaceCatalogSnapshot,
    MarketplaceProvider,
    MarketplaceSyncCounters,
    MarketplaceSyncResult,
} from "@/src/types/contracts.marketplace";

async function resolveUnSiglaId(
    admin: SupabaseClient,
    companyId: string
): Promise<string | null> {
    const { data } = await admin
        .from("siglas_comerciais")
        .select("id, sigla")
        .eq("company_id", companyId)
        .limit(20);
    const rows = data ?? [];
    const un = rows.find((r) => String(r.sigla).toUpperCase() === "UN");
    return un?.id ? String(un.id) : rows[0]?.id ? String(rows[0].id) : null;
}

async function ensureCategory(
    admin: SupabaseClient,
    companyId: string,
    categoryName: string
): Promise<string | null> {
    const name = categoryName.trim() || "Geral";
    const { data: existing } = await admin
        .from("categories")
        .select("id")
        .eq("company_id", companyId)
        .ilike("name", name)
        .limit(1)
        .maybeSingle();
    if (existing?.id) return String(existing.id);

    const { data: created, error } = await admin
        .from("categories")
        .insert({ company_id: companyId, name })
        .select("id")
        .single();
    if (error || !created?.id) {
        console.warn("[marketplace/sync] category:", error?.message);
        return null;
    }
    return String(created.id);
}

async function downloadImageBestEffort(
    admin: SupabaseClient,
    companyId: string,
    productId: string,
    imageUrl: string | null
): Promise<boolean> {
    if (!imageUrl?.startsWith("http")) return false;
    try {
        const res = await fetch(imageUrl, {
            cache: "no-store",
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100 || buf.length > 5_000_000) return false;
        const contentType = res.headers.get("content-type") ?? "image/jpeg";
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const path = `${companyId}/${productId}/mkt-${Date.now()}.${ext}`;
        const { error: upErr } = await admin.storage
            .from("product-images")
            .upload(path, buf, { contentType, upsert: true });
        if (upErr) return false;
        const { data: pub } = admin.storage.from("product-images").getPublicUrl(path);
        const url = pub?.publicUrl;
        if (!url) return false;
        await admin.from("product_images").insert({
            company_id: companyId,
            product_id: productId,
            url,
            thumbnail_url: url,
            is_primary: true,
        });
        return true;
    } catch {
        return false;
    }
}

async function upsertItem(
    admin: SupabaseClient,
    companyId: string,
    provider: MarketplaceProvider,
    item: MarketplaceCatalogItem,
    unSiglaId: string,
    counters: MarketplaceSyncCounters
): Promise<void> {
    const { data: mapRow } = await admin
        .from("marketplace_catalog_map")
        .select("id, product_id, produto_embalagem_id")
        .eq("company_id", companyId)
        .eq("provider", provider)
        .eq("external_item_id", item.externalItemId)
        .maybeSingle();

    const categoryId = await ensureCategory(admin, companyId, item.categoryName);

    if (mapRow?.product_id && mapRow?.produto_embalagem_id) {
        await admin
            .from("products")
            .update({
                name: item.name.slice(0, 200),
                is_active: item.available,
                show_on_menu: true,
                category_id: categoryId,
            })
            .eq("id", mapRow.product_id)
            .eq("company_id", companyId);

        await admin
            .from("produto_embalagens")
            .update({
                preco_venda: item.price,
                descricao: item.description?.slice(0, 300) ?? null,
            })
            .eq("id", mapRow.produto_embalagem_id)
            .eq("company_id", companyId);

        await admin
            .from("marketplace_catalog_map")
            .update({
                last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                category_id: categoryId,
            })
            .eq("id", mapRow.id);

        counters.updated += 1;
        return;
    }

    const { data: product, error: pErr } = await admin
        .from("products")
        .insert({
            company_id: companyId,
            name: item.name.slice(0, 200),
            category_id: categoryId,
            is_active: item.available,
            show_on_menu: true,
            estoque_atual: 0,
            estoque_minimo: 0,
            preco_custo_unitario: 0,
        })
        .select("id")
        .single();

    if (pErr || !product?.id) {
        const { data: byName } = await admin
            .from("products")
            .select("id")
            .eq("company_id", companyId)
            .ilike("name", item.name.trim())
            .limit(1)
            .maybeSingle();
        if (!byName?.id) {
            counters.errors += 1;
            console.warn("[marketplace/sync] create product:", pErr?.message);
            return;
        }
        const { data: embExist } = await admin
            .from("produto_embalagens")
            .select("id")
            .eq("company_id", companyId)
            .eq("produto_id", byName.id)
            .limit(1)
            .maybeSingle();
        await admin.from("marketplace_catalog_map").upsert(
            {
                company_id: companyId,
                provider,
                external_item_id: item.externalItemId,
                external_product_id: item.externalProductId,
                product_id: byName.id,
                produto_embalagem_id: embExist?.id ?? null,
                category_id: categoryId,
                last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
            { onConflict: "company_id,provider,external_item_id" }
        );
        if (embExist?.id) {
            await admin
                .from("produto_embalagens")
                .update({ preco_venda: item.price })
                .eq("id", embExist.id);
            counters.updated += 1;
        } else {
            counters.skipped += 1;
        }
        return;
    }

    const { data: emb, error: eErr } = await admin
        .from("produto_embalagens")
        .insert({
            company_id: companyId,
            produto_id: product.id,
            id_sigla_comercial: unSiglaId,
            descricao: item.description?.slice(0, 300) ?? null,
            fator_conversao: 1,
            preco_venda: item.price,
            is_acompanhamento: false,
        })
        .select("id")
        .single();

    if (eErr || !emb?.id) {
        counters.errors += 1;
        console.warn("[marketplace/sync] create embalagem:", eErr?.message);
        return;
    }

    await admin.from("marketplace_catalog_map").upsert(
        {
            company_id: companyId,
            provider,
            external_item_id: item.externalItemId,
            external_product_id: item.externalProductId,
            product_id: product.id,
            produto_embalagem_id: emb.id,
            category_id: categoryId,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,provider,external_item_id" }
    );

    const imgOk = await downloadImageBestEffort(admin, companyId, product.id, item.imageUrl);
    if (imgOk) counters.imagesDownloaded += 1;
    counters.created += 1;
}

export async function syncCatalogFromSnapshot(
    admin: SupabaseClient,
    companyId: string,
    provider: MarketplaceProvider,
    snapshot: MarketplaceCatalogSnapshot
): Promise<MarketplaceSyncResult> {
    const finishedAt = new Date().toISOString();
    const counters: MarketplaceSyncCounters = {
        created: 0,
        updated: 0,
        skipped: 0,
        imagesDownloaded: 0,
        errors: 0,
    };

    const unSiglaId = await resolveUnSiglaId(admin, companyId);
    if (!unSiglaId) {
        return {
            ok: false,
            provider,
            counters,
            finishedAt,
            errorMessage: "Empresa sem sigla comercial UN cadastrada.",
        };
    }

    for (const item of snapshot.items) {
        try {
            await upsertItem(admin, companyId, provider, item, unSiglaId, counters);
        } catch (err) {
            counters.errors += 1;
            console.warn(
                "[marketplace/sync] item failed:",
                item.externalItemId,
                err instanceof Error ? err.message : err
            );
        }
    }

    const ok = counters.errors === 0 || counters.created + counters.updated > 0;
    return {
        ok,
        provider,
        counters,
        finishedAt,
        errorMessage: ok ? null : "Sync parcial com erros — veja logs.",
    };
}
