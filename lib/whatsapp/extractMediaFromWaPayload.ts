/**
 * Extrai id de mídia do payload bruto da Meta (webhook / messages API).
 * O inbox armazena o objeto `msg` completo; a UI antiga esperava `_media`.
 */

export type WaUiMedia = {
    type:    "image" | "video" | "audio" | "document";
    id:      string;
    caption?: string | null;
};

function pickId(obj: unknown): string | null {
    const id = (obj as { id?: unknown })?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
}

export function extractMediaFromWaPayload(
    raw: Record<string, unknown> | null | undefined
): WaUiMedia | null {
    if (!raw) return null;

    const legacy = (raw as { _media?: WaUiMedia })._media;
    if (legacy && typeof legacy.id === "string" && legacy.id && typeof legacy.type === "string") {
        return {
            type:    legacy.type as WaUiMedia["type"],
            id:      legacy.id,
            caption: legacy.caption ?? null,
        };
    }

    const msgType = raw.type as string | undefined;
    if (!msgType) return null;

    if (msgType === "image") {
        const id = pickId((raw as { image?: unknown }).image);
        if (id) {
            const cap = (raw as { image?: { caption?: string } }).image?.caption;
            return { type: "image", id, caption: cap ?? null };
        }
    }
    if (msgType === "video") {
        const id = pickId((raw as { video?: unknown }).video);
        if (id) {
            const cap = (raw as { video?: { caption?: string } }).video?.caption;
            return { type: "video", id, caption: cap ?? null };
        }
    }
    if (msgType === "audio") {
        const id = pickId((raw as { audio?: unknown }).audio);
        if (id) return { type: "audio", id };
    }
    if (msgType === "document") {
        const id = pickId((raw as { document?: unknown }).document);
        if (id) {
            const cap = (raw as { document?: { caption?: string } }).document?.caption;
            return { type: "document", id, caption: cap ?? null };
        }
    }

    return null;
}
