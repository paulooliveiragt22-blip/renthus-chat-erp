/**
 * POST /api/products/upload-image
 *
 * Upload e otimização de imagem de produto.
 * Form fields: product_id (string), file (File), is_primary ("true"|"false")
 *
 * Processa:
 *   - Redimensiona para 800x800 max (JPEG 80%)
 *   - Gera thumbnail 200x200 (JPEG 70%)
 *   - Faz upload para Supabase Storage bucket "product-images"
 *   - Salva registro em product_images
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { assertUploadAllowed } from "@/lib/security/uploadGuards";
import sharp from "sharp";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Requer autenticação (rota do dashboard)
  const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { admin, userId } = ctx;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const productId = formData.get("product_id") as string | null;
  const file      = formData.get("file") as File | null;
  const isPrimary = formData.get("is_primary") === "true";

  if (!productId || !file) {
    return NextResponse.json({ error: "product_id and file required" }, { status: 400 });
  }

  const guard = assertUploadAllowed(file, "product_image");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Valida que o produto pertence à empresa do usuário
  const { data: product } = await admin
    .from("products")
    .select("id, company_id")
    .eq("id", productId)
    .eq("company_id", ctx.companyId)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  // Converte para buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer      = Buffer.from(arrayBuffer);

  // Otimiza imagem principal (max 800x800, JPEG 80%)
  const optimized = await sharp(buffer)
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  // Gera thumbnail (200x200 crop, JPEG 70%)
  const thumbnail = await sharp(buffer)
    .resize(200, 200, { fit: "cover" })
    .jpeg({ quality: 70 })
    .toBuffer();

  const ts           = Date.now();
  const mainFilename = `${productId}/${ts}.jpg`;
  const thumbFilename = `${productId}/${ts}_thumb.jpg`;

  // Upload imagem principal
  const { error: uploadErr } = await admin.storage
    .from("product-images")
    .upload(mainFilename, optimized, {
      contentType:  "image/jpeg",
      cacheControl: "31536000",
      upsert:       false,
    });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  // Upload thumbnail
  await admin.storage
    .from("product-images")
    .upload(thumbFilename, thumbnail, {
      contentType:  "image/jpeg",
      cacheControl: "31536000",
      upsert:       false,
    });

  // URLs públicas
  const { data: { publicUrl } } = admin.storage
    .from("product-images")
    .getPublicUrl(mainFilename);

  const { data: { publicUrl: thumbUrl } } = admin.storage
    .from("product-images")
    .getPublicUrl(thumbFilename);

  // Salva no banco
  const { data: imageRecord, error: dbErr } = await admin
    .from("product_images")
    .insert({
      product_id:    productId,
      url:           publicUrl,
      thumbnail_url: thumbUrl,
      is_primary:    isPrimary,
      file_size:     optimized.length,
      uploaded_by:   userId,
    })
    .select("id")
    .single();

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    image: {
      id:            imageRecord.id,
      url:           publicUrl,
      thumbnail_url: thumbUrl,
      file_size:     optimized.length,
    },
  });
}
