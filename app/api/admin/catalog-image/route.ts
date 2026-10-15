import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { assertUploadAllowed } from "@/lib/security/uploadGuards";

export const runtime = "nodejs";

/** Foto do combo ou arte da promoção. Uma imagem por registro. */
export async function POST(request: NextRequest) {
    const ctx = await requireCapability("products.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
    }

    const kind = String(formData.get("kind") ?? "");
    const id = String(formData.get("id") ?? "").trim();
    const file = formData.get("file");
    if ((kind !== "combo" && kind !== "promo") || !id || !(file instanceof File)) {
        return NextResponse.json({ error: "kind_id_file_required" }, { status: 400 });
    }
    const guard = assertUploadAllowed(file, "product_image");
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const table = kind === "combo" ? "combos" : "promocoes";
    const { data: row } = await admin.from(table).select("id").eq("id", id).eq("company_id", companyId).maybeSingle();
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const optimized = await sharp(Buffer.from(await file.arrayBuffer()))
        .resize(kind === "promo" ? 1200 : 800, kind === "promo" ? 480 : 800, {
            fit: "cover",
            withoutEnlargement: false,
        })
        .jpeg({ quality: 80 })
        .toBuffer();

    const path = `${companyId}/${kind}/${id}.jpg`;
    const { error: uploadErr } = await admin.storage.from("product-images").upload(path, optimized, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
    });
    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

    const { data: pub } = admin.storage.from("product-images").getPublicUrl(path);
    const imagePath = `${pub.publicUrl}?v=${Date.now()}`;
    const { error: updErr } = await admin
        .from(table)
        .update({ image_path: imagePath })
        .eq("id", id)
        .eq("company_id", companyId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, image_path: imagePath });
}
