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

export function buildPublicMenuAbsoluteUrl(
    slug: string,
    opts?: {
        utmSource?: string;
        /** Token assinado `wm` (WhatsApp → pré-identifica cliente). */
        wmToken?: string;
        env?: NodeJS.ProcessEnv;
    }
): string {
    const base = resolvePublicAppBaseUrl(opts?.env);
    const path = buildPublicMenuPath(slug);
    const url = new URL(`${base}${path}`);
    const utm = opts?.utmSource?.trim();
    if (utm) url.searchParams.set("utm_source", utm);
    const wm = opts?.wmToken?.trim();
    if (wm) url.searchParams.set("wm", wm);
    return url.toString();
}
