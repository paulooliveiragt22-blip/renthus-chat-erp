/** Hosts permitidos para raiz da Graph API (WhatsApp / Instagram). */
const TRUSTED_GRAPH_HOSTS = new Set(["graph.facebook.com", "graph.instagram.com"]);

/**
 * Normaliza `base_url` do canal para HTTPS em host confiável, ou retorna null.
 */
export function trustedHttpsGraphRootOrNull(raw: string): string | null {
    const s = raw.trim().replace(/\/$/, "");
    if (!s) return null;
    let u: URL;
    try {
        u = new URL(s.includes("://") ? s : `https://${s}`);
    } catch {
        return null;
    }
    if (u.protocol !== "https:") return null;
    if (!TRUSTED_GRAPH_HOSTS.has(u.hostname)) return null;
    const path = u.pathname.replace(/\/$/, "");
    return `${u.origin}${path}`;
}

/**
 * URL de download binário retornada pela Meta após GET /{media-id}?fields=url.
 * Bloqueia SSRF para hosts arbitrários.
 */
export function trustedMetaBinaryDownloadUrlOrNull(mediaUrlRaw: string): URL | null {
    let u: URL;
    try {
        u = new URL(mediaUrlRaw);
    } catch {
        return null;
    }
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    const ok =
        h === "lookaside.fbsbx.com" ||
        h.endsWith(".fbcdn.net") ||
        h.endsWith(".fbsbx.com");
    if (!ok) return null;
    return u;
}
