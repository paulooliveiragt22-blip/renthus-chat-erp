/**
 * Resolve hostname do request (Vercel: preferir x-forwarded-host).
 * Sem porta; lowercase.
 */
export function resolveRequestHostname(headers: {
    get(name: string): string | null;
}): string {
    const forwarded = headers.get("x-forwarded-host");
    const raw =
        (forwarded?.split(",")[0] ?? headers.get("host") ?? "").trim();
    return raw.split(":")[0]?.trim().toLowerCase() ?? "";
}

/** Host dedicado do console platform (env). Vazio = gate desligado. */
export function getPlatformAdminHost(): string {
    return process.env.PLATFORM_ADMIN_HOST?.trim().toLowerCase() ?? "";
}

/**
 * true se o request pode servir /platform neste Host.
 * Sem PLATFORM_ADMIN_HOST configurado → sempre true.
 */
export function isPlatformAdminHostAllowed(headers: {
    get(name: string): string | null;
}): boolean {
    const expected = getPlatformAdminHost();
    if (!expected) return true;
    const actual = resolveRequestHostname(headers);
    if (!actual) return true; // sem Host: deixa IP/MFA decidirem (edge case)
    return actual === expected;
}

/** Redirect canônico para o host dedicado (UI). */
export function platformAdminCanonicalUrl(
    pathname: string,
    search = ""
): string {
    const host = getPlatformAdminHost();
    const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const qs = search && !search.startsWith("?") ? `?${search}` : search;
    return `https://${host}${path}${qs}`;
}

/** Hostname efetivo do request (header ou URL). */
export function resolveEffectiveRequestHostname(
    headers: { get(name: string): string | null },
    urlHostname: string
): string {
    return (
        resolveRequestHostname(headers) || urlHostname.trim().toLowerCase()
    );
}

/** Request chegou no host dedicado do console platform. */
export function isPlatformDedicatedHostRequest(
    headers: { get(name: string): string | null },
    urlHostname: string
): boolean {
    const expected = getPlatformAdminHost();
    if (!expected) return false;
    return resolveEffectiveRequestHostname(headers, urlHostname) === expected;
}
