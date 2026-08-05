import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

async function assertProductBelongs(admin: SupabaseClient, companyId: string, productId: string) {
    const { data, error } = await admin
        .from("products")
        .select("id")
        .eq("id", productId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!data) return { ok: false as const, error: "product_not_found" };
    return { ok: true as const };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;
    const productId = String(rawId ?? "").trim();
    if (!productId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const chk = await assertProductBelongs(admin, companyId, productId);
    if (!chk.ok) return NextResponse.json({ error: chk.error }, { status: chk.error === "product_not_found" ? 404 : 500 });

    const { data, error } = await admin
        .from("product_images")
        .select("id, url, thumbnail_url, is_primary, file_size, created_at, product_volume_id")
        .eq("product_id", productId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ images: data ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;
    const productId = String(rawId ?? "").trim();
    if (!productId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const chk = await assertProductBelongs(admin, companyId, productId);
    if (!chk.ok) return NextResponse.json({ error: chk.error }, { status: chk.error === "product_not_found" ? 404 : 500 });

    const body = (await req.json().catch(() => ({}))) as { image_id?: string };
    const imageId = String(body.image_id ?? "").trim();
    if (!imageId) return NextResponse.json({ error: "image_id_required" }, { status: 400 });

    const { data: target, error: tErr } = await admin
        .from("product_images")
        .select("id, product_volume_id")
        .eq("id", imageId)
        .eq("product_id", productId)
        .maybeSingle();
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (!target) return NextResponse.json({ error: "image_not_found" }, { status: 404 });

    // Demote só no mesmo escopo (produto geral ou volume)
    let demote = admin
        .from("product_images")
        .update({ is_primary: false })
        .eq("product_id", productId);
    demote = target.product_volume_id
        ? demote.eq("product_volume_id", target.product_volume_id)
        : demote.is("product_volume_id", null);
    const { error: u1 } = await demote;
    if (u1) return NextResponse.json({ error: u1.message }, { status: 500 });

    const { error: u2 } = await admin
        .from("product_images")
        .update({ is_primary: true })
        .eq("id", imageId)
        .eq("product_id", productId);
    if (u2) return NextResponse.json({ error: u2.message }, { status: 500 });

    return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;
    const productId = String(rawId ?? "").trim();
    if (!productId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const chk = await assertProductBelongs(admin, companyId, productId);
    if (!chk.ok) return NextResponse.json({ error: chk.error }, { status: chk.error === "product_not_found" ? 404 : 500 });

    const imageId = String(req.nextUrl.searchParams.get("image_id") ?? "").trim();
    if (!imageId) return NextResponse.json({ error: "image_id_required" }, { status: 400 });

    const { data: img, error: fetchErr } = await admin
        .from("product_images")
        .select("id, url, thumbnail_url")
        .eq("id", imageId)
        .eq("product_id", productId)
        .maybeSingle();
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!img) return NextResponse.json({ error: "image_not_found" }, { status: 404 });

    const storagePaths: string[] = [];
    for (const u of [img.url, img.thumbnail_url]) {
        if (!u || typeof u !== "string") continue;
        const marker = "/product-images/";
        const idx = u.indexOf(marker);
        if (idx >= 0) storagePaths.push(u.slice(idx + marker.length));
    }
    if (storagePaths.length) {
        await admin.storage.from("product-images").remove(storagePaths);
    }

    const { error } = await admin.from("product_images").delete().eq("id", imageId).eq("product_id", productId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
