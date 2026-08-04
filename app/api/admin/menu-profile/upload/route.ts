/**
 * POST /api/admin/menu-profile/upload
 * Form: kind=logo|cover, file=File
 * Otimiza com sharp, sobe no Storage e atualiza company_menu_profile.
 */

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { assertUploadAllowed } from "@/lib/security/uploadGuards";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
    }

    const kindRaw = String(formData.get("kind") ?? "").toLowerCase();
    const kind = kindRaw === "cover" ? "cover" : kindRaw === "logo" ? "logo" : null;
    const file = formData.get("file");
    if (!kind || !(file instanceof File)) {
        return NextResponse.json({ error: "kind_and_file_required" }, { status: 400 });
    }

    const guard = assertUploadAllowed(file, "menu_branding");
    if (!guard.ok) {
        return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const optimized =
        kind === "cover"
            ? await sharp(buffer)
                  .resize(1600, 630, { fit: "cover", position: "centre" })
                  .jpeg({ quality: 82 })
                  .toBuffer()
            : await sharp(buffer)
                  .resize(512, 512, { fit: "cover", position: "centre" })
                  .jpeg({ quality: 85 })
                  .toBuffer();

    const path = `${companyId}/menu/${kind}-${Date.now()}.jpg`;
    const { error: upErr } = await admin.storage.from("product-images").upload(path, optimized, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: false,
    });
    if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    const { data: pub } = admin.storage.from("product-images").getPublicUrl(path);
    const url = pub?.publicUrl;
    if (!url) {
        return NextResponse.json({ error: "public_url_failed" }, { status: 500 });
    }

    const col = kind === "cover" ? "cover_url" : "logo_url";
    const { data: existing } = await admin
        .from("company_menu_profile")
        .select("company_id")
        .eq("company_id", companyId)
        .maybeSingle();

    if (!existing) {
        return NextResponse.json(
            { error: "profile_missing", hint: "Salve o cardápio (nome/slug) antes de enviar fotos." },
            { status: 400 }
        );
    }

    const { error: updErr } = await admin
        .from("company_menu_profile")
        .update({ [col]: url, updated_at: new Date().toISOString() })
        .eq("company_id", companyId);

    if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, kind, url });
}
