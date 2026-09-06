/**
 * Filtro da lista de inbox (card esquerdo).
 * Campo canônico: whatsapp_threads.channel
 */

export const INBOX_CHANNEL_FILTERS = ["all", "whatsapp", "meta"] as const;
export type InboxChannelFilter = (typeof INBOX_CHANNEL_FILTERS)[number];

const URL_ALIASES: Record<string, InboxChannelFilter> = {
    all: "all",
    wa: "whatsapp",
    whatsapp: "whatsapp",
    meta: "meta",
    ig: "meta",
};

export function parseInboxChannelFilter(raw: string | null | undefined): InboxChannelFilter {
    const key = (raw ?? "").trim().toLowerCase();
    return URL_ALIASES[key] ?? "all";
}

export function inboxChannelFilterQueryValue(filter: InboxChannelFilter): string | null {
    return filter === "all" ? null : filter;
}

export function threadMatchesInboxFilter(
    channel: string | null | undefined,
    filter: InboxChannelFilter
): boolean {
    const c = (channel ?? "whatsapp").trim() || "whatsapp";
    if (filter === "all") return true;
    if (filter === "whatsapp") return c === "whatsapp";
    return c === "instagram" || c === "messenger";
}

export function inboxFilterForThreadChannel(
    channel: string | null | undefined
): InboxChannelFilter {
    const c = (channel ?? "whatsapp").trim() || "whatsapp";
    if (c === "instagram" || c === "messenger") return "meta";
    return "whatsapp";
}

export type InboxChannelSql =
    | { kind: "all" }
    | { kind: "or"; expr: string }
    | { kind: "in"; column: "channel"; values: readonly ["instagram", "messenger"] };

/** Descritor PostgREST do chip — o route aplica no builder (evita inferência infinita do client). */
export function inboxChannelSql(filter: InboxChannelFilter): InboxChannelSql {
    if (filter === "whatsapp") {
        return { kind: "or", expr: "channel.eq.whatsapp,channel.is.null" };
    }
    if (filter === "meta") {
        return { kind: "in", column: "channel", values: ["instagram", "messenger"] };
    }
    return { kind: "all" };
}

type ChannelFilterQuery = {
    or: (expr: string) => ChannelFilterQuery;
    in: (column: string, values: readonly string[]) => ChannelFilterQuery;
};

/** Helper de teste / builders simples. */
export function applyInboxChannelFilter(
    query: ChannelFilterQuery,
    filter: InboxChannelFilter
): ChannelFilterQuery {
    const sql = inboxChannelSql(filter);
    if (sql.kind === "or") return query.or(sql.expr);
    if (sql.kind === "in") return query.in(sql.column, sql.values);
    return query;
}

export function inboxFilterEmptyCopy(filter: InboxChannelFilter, hasQuery: boolean): string {
    if (hasQuery) return "Nenhum resultado.";
    if (filter === "whatsapp") return "Nenhuma conversa no WhatsApp.";
    if (filter === "meta") return "Nenhuma conversa no Instagram ou Messenger.";
    return "Nenhuma conversa.";
}
