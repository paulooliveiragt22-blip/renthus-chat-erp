export const COEXISTENCE_WEBHOOK_FIELDS = [
    "smb_message_echoes",
    "history",
    "smb_app_state_sync",
    "account_update",
] as const;

export type CoexistenceWebhookField = (typeof COEXISTENCE_WEBHOOK_FIELDS)[number];

export function isCoexistenceWebhookField(field: string): field is CoexistenceWebhookField {
    return (COEXISTENCE_WEBHOOK_FIELDS as readonly string[]).includes(field);
}

export type ParsedCoexistenceMessage = {
    waId: string;
    from: string;
    to: string;
    body: string;
    type: string;
    raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function extractBody(msg: Record<string, unknown>): string {
    const type = String(msg.type ?? "text");
    if (type === "text") {
        const text = asRecord(msg.text);
        return typeof text?.body === "string" ? text.body : "";
    }
    return "";
}

function parseMessageLike(raw: unknown): ParsedCoexistenceMessage | null {
    const msg = asRecord(raw);
    if (!msg) return null;
    const waId = String(msg.id ?? "").trim();
    const from = String(msg.from ?? "").trim();
    const to = String(msg.to ?? "").trim();
    if (!waId || !from) return null;
    return {
        waId,
        from,
        to,
        body: extractBody(msg),
        type: String(msg.type ?? "text"),
        raw: msg,
    };
}

export function parseMessageEchoes(value: unknown): ParsedCoexistenceMessage[] {
    const rec = asRecord(value);
    const list = rec?.message_echoes;
    if (!Array.isArray(list)) return [];
    return list.map(parseMessageLike).filter((m): m is ParsedCoexistenceMessage => Boolean(m));
}

export function parseHistoryMessages(value: unknown): ParsedCoexistenceMessage[] {
    const rec = asRecord(value);
    const history = rec?.history;
    if (!Array.isArray(history)) return [];
    const out: ParsedCoexistenceMessage[] = [];
    for (const chunk of history) {
        const chunkRec = asRecord(chunk);
        const threads = chunkRec?.threads;
        if (!Array.isArray(threads)) continue;
        for (const thread of threads) {
            const t = asRecord(thread);
            const messages = t?.messages;
            if (!Array.isArray(messages)) continue;
            for (const m of messages) {
                const parsed = parseMessageLike(m);
                if (parsed) out.push(parsed);
            }
        }
    }
    return out;
}

export function parseAccountUpdateEvent(value: unknown): {
    event: string;
    wabaId: string | null;
} {
    const rec = asRecord(value);
    const event = String(rec?.event ?? "");
    const info = asRecord(rec?.waba_info);
    const wabaId = typeof info?.waba_id === "string" ? info.waba_id.trim() : null;
    return { event, wabaId };
}

export function isBusinessSender(from: string, businessDisplayPhone: string | null): boolean {
    const a = from.replaceAll(/\D/g, "");
    const b = (businessDisplayPhone ?? "").replaceAll(/\D/g, "");
    if (!a || !b) return false;
    return a === b || a.endsWith(b) || b.endsWith(a);
}
