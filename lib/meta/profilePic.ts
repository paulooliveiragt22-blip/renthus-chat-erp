/** URL https vinda do Graph. Rejeita o resto para não ir parar num <img>. */
export function sanitizeMetaProfilePicUrl(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const url = raw.trim();
    if (!url || url.length > 2000) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:") return null;
    return url;
}

export function readMetaProfilePicUrl(json: Record<string, unknown>): string | null {
    return sanitizeMetaProfilePicUrl(json.profile_pic);
}

export const PROFILE_PIC_REFRESH_TTL_MS = 12 * 60 * 60 * 1000;
export const PROFILE_PIC_REFRESH_LIMIT = 8;

export type ProfilePicThreadRow = {
    id: string;
    channel?: string | null;
    external_id?: string | null;
    profile_pic_url?: string | null;
    profile_pic_fetched_at?: string | null;
};

export function isMetaInboxChannel(channel: string | null | undefined): channel is "instagram" | "messenger" {
    return channel === "instagram" || channel === "messenger";
}

/** Threads IG/Messenger cuja foto falta ou passou do prazo. Ordem da lista, com teto. */
export function selectThreadsForProfilePicRefresh<T extends ProfilePicThreadRow>(
    threads: readonly T[],
    nowMs: number,
    limit = PROFILE_PIC_REFRESH_LIMIT
): T[] {
    const out: T[] = [];
    for (const thread of threads) {
        if (out.length >= limit) break;
        if (!isMetaInboxChannel(thread.channel)) continue;
        if (!thread.external_id?.trim()) continue;
        const fetched = thread.profile_pic_fetched_at
            ? Date.parse(thread.profile_pic_fetched_at)
            : Number.NaN;
        const fresh = Number.isFinite(fetched) && nowMs - fetched < PROFILE_PIC_REFRESH_TTL_MS;
        if (fresh) continue;
        out.push(thread);
    }
    return out;
}
