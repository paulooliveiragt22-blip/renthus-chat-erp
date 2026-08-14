/**
 * Helpers puros de URL do cardápio (sem I/O). Usados no bot (cta_url) e no handoff.
 */

export function withMenuSearchParams(
    url: string,
    extra: Record<string, string | undefined | null>
): string {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    const parsed = new URL(trimmed);
    for (const [key, value] of Object.entries(extra)) {
        const v = value?.trim();
        if (v) parsed.searchParams.set(key, v);
    }
    return parsed.toString();
}

/** Extrai slug de `/c/{slug}` ou `{slug}.dominio`. */
export function parseSlugFromPublicMenuUrl(url: string): string | null {
    try {
        const parsed = new URL(url.trim());
        const path = parsed.pathname.match(/^\/c\/([a-z0-9][a-z0-9-]{1,62})\/?$/i);
        if (path?.[1]) return path[1].toLowerCase();
        const host = parsed.hostname.toLowerCase();
        const first = host.split(".")[0]?.trim() ?? "";
        if (first && first !== "www" && first !== "app" && /^[a-z0-9][a-z0-9-]{1,62}$/.test(first)) {
            return first;
        }
        return null;
    } catch {
        return null;
    }
}
