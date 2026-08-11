import { parseMenuSlug } from "@/lib/public-menu/slug";
import type { EnvLike } from "@/lib/env/EnvLike";

const HOST_RE =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Normaliza Host header (lowercase, sem porta, sem www.). */
export function normalizeMenuHost(raw: string): string {
    let host = raw.trim().toLowerCase();
    host = host.replace(/:\d+$/, "").replace(/\.$/, "");
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
}

/** Valida input de domínio próprio do admin. */
export function normalizeCustomDomainInput(
    raw: unknown
): { ok: true; host: string } | { ok: false; error: "domain_empty" | "domain_invalid" } {
    if (typeof raw !== "string" || !raw.trim()) {
        return { ok: false, error: "domain_empty" };
    }
    let s = raw.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, "");
    s = s.split("/")[0] ?? "";
    s = normalizeMenuHost(s);
    if (!s) return { ok: false, error: "domain_empty" };
    if (s.length > 253 || !HOST_RE.test(s)) {
        return { ok: false, error: "domain_invalid" };
    }
    return { ok: true, host: s };
}

export function resolveMenuBaseDomain(
    env: EnvLike = process.env
): string | null {
    const d = env.NEXT_PUBLIC_MENU_BASE_DOMAIN?.trim().toLowerCase();
    if (!d) return null;
    return normalizeMenuHost(d) || null;
}

/** Hosts do app (painel) — não devem ser tratados como cardápio vanity. */
export function isAppApexHost(
    host: string,
    env: EnvLike = process.env
): boolean {
    const h = normalizeMenuHost(host);
    if (!h) return true;
    if (h === "localhost" || h === "127.0.0.1") return true;
    if (h.endsWith(".vercel.app")) return true;

    const apex: string[] = ["app.renthus.com.br"];
    const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
    if (appUrl) {
        try {
            apex.push(normalizeMenuHost(new URL(appUrl).host));
        } catch {
            /* ignore */
        }
    }
    const vercel = env.VERCEL_URL?.trim();
    if (vercel) {
        apex.push(normalizeMenuHost(vercel.replace(/^https?:\/\//, "")));
    }
    return apex.includes(h);
}

/**
 * Se host é `{slug}.{MENU_BASE_DOMAIN}`, devolve o slug.
 * Não consulta banco (slug = subdomínio).
 */
export function slugFromMenuSubdomainHost(
    host: string,
    env: EnvLike = process.env
): string | null {
    const h = normalizeMenuHost(host);
    const base = resolveMenuBaseDomain(env);
    if (!base || !h.endsWith(`.${base}`)) return null;
    const sub = h.slice(0, -(base.length + 1));
    if (!sub || sub.includes(".")) return null;
    const parsed = parseMenuSlug(sub);
    return parsed.ok ? parsed.slug : null;
}
