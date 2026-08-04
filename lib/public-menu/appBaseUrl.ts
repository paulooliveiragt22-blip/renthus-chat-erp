import { resolveMenuBaseDomain } from "@/lib/public-menu/customDomain";

/**
 * Base URL pública do app (links para clientes — cardápio `/c/[slug]`).
 * Preferir NEXT_PUBLIC_APP_URL; em deploy Vercel, VERCEL_URL; senão fallback de produção.
 */
export function resolvePublicAppBaseUrl(
    env: NodeJS.ProcessEnv = process.env
): string {
    const fromEnv = env.NEXT_PUBLIC_APP_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, "");

    const vercel = env.VERCEL_URL?.trim();
    if (vercel) {
        const host = vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "");
        return `https://${host}`;
    }

    return "https://app.renthus.com.br";
}

export function buildPublicMenuPath(slug: string): string {
    return `/c/${slug}`;
}

function applyMenuQuery(
    url: URL,
    opts?: { utmSource?: string; wmToken?: string }
): string {
    const utm = opts?.utmSource?.trim();
    if (utm) url.searchParams.set("utm_source", utm);
    const wm = opts?.wmToken?.trim();
    if (wm) url.searchParams.set("wm", wm);
    return url.toString();
}

export function buildPublicMenuAbsoluteUrl(
    slug: string,
    opts?: {
        utmSource?: string;
        /** Token assinado `wm` (WhatsApp → pré-identifica cliente). */
        wmToken?: string;
        env?: NodeJS.ProcessEnv;
        /** Domínio próprio verificado (F4.3). */
        customDomain?: string | null;
        customDomainVerified?: boolean;
        /** Força URL path `/c/{slug}` no app (ignora vanity). */
        preferPath?: boolean;
    }
): string {
    const env = opts?.env ?? process.env;

    if (!opts?.preferPath) {
        if (opts?.customDomainVerified && opts.customDomain) {
            const url = new URL(`https://${opts.customDomain}/`);
            return applyMenuQuery(url, opts);
        }

        const menuBase = resolveMenuBaseDomain(env);
        if (menuBase) {
            const url = new URL(`https://${slug}.${menuBase}/`);
            return applyMenuQuery(url, opts);
        }
    }

    const base = resolvePublicAppBaseUrl(env);
    const url = new URL(`${base}${buildPublicMenuPath(slug)}`);
    return applyMenuQuery(url, opts);
}
