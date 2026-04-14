/** UUID usado em `whatsapp_threads.id` e `channel_id` (mesmo critério da rota de mídia). */
const UUID_STRING_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOptionalUuid(value: string | null | undefined): string | null {
    if (value == null) return null;
    const v = value.trim();
    if (!v) return null;
    return UUID_STRING_RE.test(v) ? v : null;
}

export { sanitizeWhatsAppMediaPathId } from "@/lib/whatsapp/mediaIdPath";
