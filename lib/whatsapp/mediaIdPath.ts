/**
 * IDs de mídia na WhatsApp Cloud API (Meta) — alinhado a `app/api/whatsapp/media/[mediaId]/route.ts`.
 */
export const META_MEDIA_ID_PATH_RE = /^\d{6,64}$/;

export function sanitizeWhatsAppMediaPathId(id: string | null | undefined): string | null {
    if (id == null) return null;
    const v = id.trim();
    if (!v) return null;
    return META_MEDIA_ID_PATH_RE.test(v) ? v : null;
}
