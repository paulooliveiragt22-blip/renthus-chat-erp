import {
    isAppApexHost,
    normalizeMenuHost,
    slugFromMenuSubdomainHost,
} from "@/lib/public-menu/customDomain";
import type { EnvLike } from "@/lib/env/EnvLike";

export type MenuHostRewrite =
    | { rewrite: true; slug: string; pathname: string }
    | { rewrite: false };

/**
 * Decide se o request vanity (subdomínio / domínio próprio) deve ir para /c/{slug}.
 * Lookup de custom domain via callback (RPC no proxy).
 */
export async function resolveMenuHostRewrite(params: {
    host: string;
    pathname: string;
    env?: EnvLike;
    lookupCustomDomainSlug?: (host: string) => Promise<string | null>;
}): Promise<MenuHostRewrite> {
    const env = params.env ?? process.env;
    const host = normalizeMenuHost(params.host);
    const pathname = params.pathname || "/";

    if (!host || isAppApexHost(host, env)) {
        return { rewrite: false };
    }

    // Já no path canônico
    if (pathname === "/c" || pathname.startsWith("/c/")) {
        return { rewrite: false };
    }
    // APIs e assets não reescrevem
    if (
        pathname.startsWith("/api/") ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico"
    ) {
        return { rewrite: false };
    }

    let slug = slugFromMenuSubdomainHost(host, env);
    if (!slug && params.lookupCustomDomainSlug) {
        slug = (await params.lookupCustomDomainSlug(host)) ?? null;
    }
    if (!slug) return { rewrite: false };

    // MVP: só a raiz do domínio vanity → cardápio
    if (pathname === "/" || pathname === "") {
        return { rewrite: true, slug, pathname: `/c/${slug}` };
    }

    return { rewrite: false };
}

export async function lookupMenuSlugByHostViaRest(params: {
    host: string;
    supabaseUrl: string;
    serviceKey: string;
}): Promise<string | null> {
    try {
        const res = await fetch(`${params.supabaseUrl}/rest/v1/rpc/rpc_resolve_menu_slug_by_host`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${params.serviceKey}`,
                apikey: params.serviceKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ p_host: params.host }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as string | null;
        return typeof data === "string" && data.trim() ? data.trim() : null;
    } catch {
        return null;
    }
}
