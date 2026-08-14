/**
 * POST /api/products/upload-image
 *
 * Form: product_id, file, is_primary,
 *       produto_embalagem_id (preferido — foto por sigla/item),
 *       product_volume_id (legado — foto por tamanho).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { assertUploadAllowed } from "@/lib/security/uploadGuards";
import sharp from "sharp";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const ctx = await requireCapability("products.read");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { admin, userId } = ctx;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const productId = formData.get("product_id") as string | null;
  const file = formData.get("file") as File | null;
  const isPrimary = formData.get("is_primary") !== "false";
  const embRaw = formData.get("produto_embalagem_id");
  const volumeRaw = formData.get("product_volume_id");
  const produtoEmbalagemId =
    typeof embRaw === "string" && embRaw.trim() ? embRaw.trim() : null;
  let productVolumeId =
    typeof volumeRaw === "string" && volumeRaw.trim() ? volumeRaw.trim() : null;

  if (!productId || !file) {
    return NextResponse.json({ error: "product_id and file required" }, { status: 400 });
  }

  const guard = assertUploadAllowed(file, "product_image");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { data: product } = await admin
    .from("products")
    .select("id, company_id")
    .eq("id", productId)
    .eq("company_id", ctx.companyId)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  if (produtoEmbalagemId) {
    const { data: emb } = await admin
      .from("produto_embalagens")
      .select("id, product_volume_id")
      .eq("id", produtoEmbalagemId)
      .eq("produto_id", productId)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (!emb) {
      return NextResponse.json({ error: "produto_embalagem_not_found" }, { status: 404 });
    }
    // Preenche volume auxiliar (não define o escopo da primary)
    if (!productVolumeId && emb.product_volume_id) {
      productVolumeId = String(emb.product_volume_id);
    }
  } else if (productVolumeId) {
    const { data: vol } = await admin
      .from("product_volumes")
      .select("id")
      .eq("id", productVolumeId)
      .eq("product_id", productId)
      .maybeSingle();
    if (!vol) {
      return NextResponse.json({ error: "product_volume_not_found" }, { status: 404 });
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const optimized = await sharp(buffer)
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const thumbnail = await sharp(buffer)
    .resize(200, 200, { fit: "cover" })
    .jpeg({ quality: 70 })
    .toBuffer();

  const ts = Date.now();
  const folder = produtoEmbalagemId
    ? `${ctx.companyId}/${productId}/emb/${produtoEmbalagemId}`
    : productVolumeId
      ? `${ctx.companyId}/${productId}/${productVolumeId}`
      : `${ctx.companyId}/${productId}`;
  const mainFilename = `${folder}/${ts}.jpg`;
  const thumbFilename = `${folder}/${ts}_thumb.jpg`;

  const { error: uploadErr } = await admin.storage
    .from("product-images")
    .upload(mainFilename, optimized, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  await admin.storage.from("product-images").upload(thumbFilename, thumbnail, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });

  const {
    data: { publicUrl },
  } = admin.storage.from("product-images").getPublicUrl(mainFilename);
  const {
    data: { publicUrl: thumbUrl },
  } = admin.storage.from("product-images").getPublicUrl(thumbFilename);

  if (isPrimary) {
    let demote = admin
      .from("product_images")
      .update({ is_primary: false })
      .eq("product_id", productId);
    if (produtoEmbalagemId) {
      demote = demote.eq("produto_embalagem_id", produtoEmbalagemId);
    } else if (productVolumeId) {
      demote = demote.is("produto_embalagem_id", null).eq("product_volume_id", productVolumeId);
    } else {
      demote = demote.is("produto_embalagem_id", null).is("product_volume_id", null);
    }
    await demote;
  }

  const { data: imageRecord, error: dbErr } = await admin
    .from("product_images")
    .insert({
      product_id: productId,
      product_volume_id: productVolumeId,
      produto_embalagem_id: produtoEmbalagemId,
      url: publicUrl,
      thumbnail_url: thumbUrl,
      is_primary: isPrimary,
      file_size: optimized.length,
      uploaded_by: userId,
    })
    .select("id")
    .single();

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    image: {
      id: imageRecord.id,
      url: publicUrl,
      thumbnail_url: thumbUrl,
      file_size: optimized.length,
      product_volume_id: productVolumeId,
      produto_embalagem_id: produtoEmbalagemId,
      is_primary: isPrimary,
    },
  });
}
