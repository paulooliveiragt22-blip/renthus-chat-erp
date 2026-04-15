import { sanitizeWhatsAppMediaPathId } from "@/lib/whatsapp/mediaIdPath";
import { parseOptionalUuid } from "@/lib/whatsapp/urlSafety";

/** Caminho relativo seguro para o proxy de mídia (sem concatenação opaca de query). */
export function buildWaMediaRelativePath(
    mediaIdRaw: string,
    channelIdFromThread: string | null | undefined
): string | null {
    const mediaId = sanitizeWhatsAppMediaPathId(mediaIdRaw);
    const ch      = parseOptionalUuid(channelIdFromThread?.trim() ?? null);
    if (!mediaId) return null;
    const base = `/api/whatsapp/media/${encodeURIComponent(mediaId)}`;
    if (!ch) return base;
    return `${base}?channel_id=${encodeURIComponent(ch)}`;
}
