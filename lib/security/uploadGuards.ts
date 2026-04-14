/**
 * Validação comum de uploads (tamanho + MIME) para rotas que enviam ficheiros ao Storage.
 */

export type UploadKind = "whatsapp_outbound" | "product_image";

const WHATSAPP_MAX_BYTES = 16 * 1024 * 1024; // alinhado ao limite comum da Meta para mídia
const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const WHATSAPP_MIMES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/webm",
    "application/pdf",
]);

const PRODUCT_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function assertUploadAllowed(
    file: File,
    kind: UploadKind
): { ok: true } | { ok: false; status: number; error: string } {
    const max =
        kind === "whatsapp_outbound" ? WHATSAPP_MAX_BYTES : PRODUCT_IMAGE_MAX_BYTES;
    if (file.size > max) {
        return {
            ok:     false,
            status: 413,
            error:  `file_too_large: max ${Math.round(max / (1024 * 1024))}MB`,
        };
    }

    const declared = (file.type || "").toLowerCase().trim();
    const allowed  =
        kind === "whatsapp_outbound" ? WHATSAPP_MIMES : PRODUCT_IMAGE_MIMES;

    if (declared && !allowed.has(declared)) {
        return { ok: false, status: 415, error: "unsupported_media_type" };
    }

    return { ok: true };
}
