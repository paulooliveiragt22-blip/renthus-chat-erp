import "server-only";

export type MetaMessagingEvent = {
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        quick_reply?: { payload?: string };
    };
    postback?: { payload?: string; title?: string };
};

export type MetaMessagingWebhookEntry = {
    id?: string;
    messaging?: MetaMessagingEvent[];
    standby?: MetaMessagingEvent[];
    changes?: Array<{ field?: string; value?: unknown }>;
};

export type MetaMessagingWebhookBody = {
    object?: string;
    entry?: MetaMessagingWebhookEntry[];
};

/** Meta às vezes documenta payloads embrulhados em array no topo. */
export function normalizeMetaMessagingWebhookBody(
    parsed: unknown
): MetaMessagingWebhookBody | null {
    if (!parsed || typeof parsed !== "object") return null;
    if (Array.isArray(parsed)) {
        const first = parsed[0];
        if (!first || typeof first !== "object") return null;
        return first as MetaMessagingWebhookBody;
    }
    return parsed as MetaMessagingWebhookBody;
}

export function extractMetaMessagingEvents(
    entry: MetaMessagingWebhookEntry
): MetaMessagingEvent[] {
    const events: MetaMessagingEvent[] = [
        ...(Array.isArray(entry.messaging) ? entry.messaging : []),
        ...(Array.isArray(entry.standby) ? entry.standby : []),
    ];

    if (events.length > 0) return events;

    // Comentários/mentions usam changes; DMs usam messaging (doc Meta).
    // Fallback defensivo se a Meta enviar messages em changes.
    for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        if (!value || typeof value !== "object") continue;
        const v = value as Record<string, unknown>;
        if (v.messaging && Array.isArray(v.messaging)) {
            events.push(...(v.messaging as MetaMessagingEvent[]));
            continue;
        }
        if (v.sender && v.message) {
            events.push(value as MetaMessagingEvent);
        }
    }

    return events;
}

/** IDs da conta profissional (Page ou IG) para resolver meta_messaging_channels. */
export function collectMetaAccountIds(
    entry: MetaMessagingWebhookEntry,
    events: MetaMessagingEvent[]
): string[] {
    const ids = new Set<string>();
    const entryId = String(entry.id ?? "").trim();
    if (entryId) ids.add(entryId);

    for (const ev of events) {
        const recipient = String(ev.recipient?.id ?? "").trim();
        const sender = String(ev.sender?.id ?? "").trim();
        if (recipient) ids.add(recipient);
        if (sender) ids.add(sender);
    }
    return [...ids];
}
