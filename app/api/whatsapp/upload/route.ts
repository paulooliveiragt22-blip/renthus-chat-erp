import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUploadAllowed } from "@/lib/security/uploadGuards";

export const runtime = "nodejs";

const BUCKET = "whatsapp-media";

/**
 * POST /api/whatsapp/upload
 * Body: multipart/form-data with field "file" (and optional "kind": image|video|audio|document)
 * Returns: { url: string } — URL pública para usar em /api/whatsapp/send (media_url)
 *
 * Requer bucket "whatsapp-media" no Supabase Storage com acesso público de leitura.
 */
export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { companyId } = ctx;
    const formData = await req.formData().catch(() => null);
    if (!formData) return NextResponse.json({ error: "form data required" }, { status: 400 });

    const file = formData.get("file");
    if (!file || !(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

    const guard = assertUploadAllowed(file, "whatsapp_outbound");
    if (!guard.ok) {
        return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const admin = createAdminClient();
    const ext = file.name.split(".").pop() || "bin";
    const path = `${companyId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await admin.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: true,
    });

    if (uploadErr) {
        console.error("[whatsapp/upload]", uploadErr);
        return NextResponse.json(
            { error: "upload_failed", details: uploadErr.message },
            { status: 500 }
        );
    }

    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: urlData.publicUrl });
}
