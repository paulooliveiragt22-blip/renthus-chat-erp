/** Contratos da fila de mensagens proativas (`outbound_jobs`). */

export type OutboundPurpose = "cart_recovery" | "reengagement" | "promo" | "transactional";

export interface OutboundButton {
    id: string;
    title: string;
}

export type OutboundJobPayload =
    | { kind: "text"; text: string }
    | { kind: "buttons"; text: string; buttons: OutboundButton[] };

export interface OutboundJobRow {
    id: string;
    company_id: string;
    thread_id: string;
    phone_e164: string;
    purpose: OutboundPurpose;
    payload: OutboundJobPayload;
    dedup_key: string;
    source_id: string | null;
    attempts: number;
    scheduled_at: string;
}

export function isOutboundJobPayload(value: unknown): value is OutboundJobPayload {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { kind?: unknown; text?: unknown; buttons?: unknown };
    if (typeof candidate.text !== "string" || !candidate.text.trim()) return false;
    if (candidate.kind === "text") return true;
    if (candidate.kind !== "buttons") return false;
    return Array.isArray(candidate.buttons) && candidate.buttons.length > 0;
}
