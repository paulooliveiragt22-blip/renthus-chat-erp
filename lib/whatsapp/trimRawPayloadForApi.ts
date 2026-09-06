/**
 * Projeção segura de `whatsapp_messages.raw_payload` para o painel (B13 / A10).
 * Não devolve o webhook Meta completo (PII / tokens / blobs).
 */

import {
    extractMediaFromWaPayload,
    type WaUiMedia,
} from "@/lib/whatsapp/extractMediaFromWaPayload";

export type TrimmedWaRawPayload = {
    type?: string;
    _media?: WaUiMedia;
    image?: { id: string; caption?: string | null };
    video?: { id: string; caption?: string | null };
    audio?: { id: string };
    document?: { id: string; caption?: string | null };
    /** Erros de envio já persistidos — só a mensagem curta. */
    error?: string;
};

function shortError(raw: Record<string, unknown>): string | undefined {
    const err = raw.error;
    if (typeof err === "string" && err.trim()) return err.trim().slice(0, 240);
    return undefined;
}

/**
 * Reduz o payload bruto ao mínimo que o inbox precisa (mídia + erro curto).
 */
export function trimRawPayloadForApi(
    raw: Record<string, unknown> | null | undefined
): TrimmedWaRawPayload | null {
    if (!raw || typeof raw !== "object") return null;

    const media = extractMediaFromWaPayload(raw);
    const error = shortError(raw);

    if (!media && !error) {
        const type = typeof raw.type === "string" ? raw.type : undefined;
        return type ? { type } : null;
    }

    const out: TrimmedWaRawPayload = {};
    if (media) {
        out.type = media.type;
        out._media = media;
        if (media.type === "image") {
            out.image = { id: media.id, caption: media.caption ?? null };
        } else if (media.type === "video") {
            out.video = { id: media.id, caption: media.caption ?? null };
        } else if (media.type === "audio") {
            out.audio = { id: media.id };
        } else if (media.type === "document") {
            out.document = { id: media.id, caption: media.caption ?? null };
        }
    } else if (typeof raw.type === "string") {
        out.type = raw.type;
    }
    if (error) out.error = error;
    return out;
}

export function mapMessageRawPayloadForApi<T extends { raw_payload?: unknown }>(
    row: T
): Omit<T, "raw_payload"> & { raw_payload: TrimmedWaRawPayload | null } {
    const raw =
        row.raw_payload && typeof row.raw_payload === "object"
            ? (row.raw_payload as Record<string, unknown>)
            : null;
    return {
        ...row,
        raw_payload: trimRawPayloadForApi(raw),
    };
}
