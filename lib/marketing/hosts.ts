import type { EnvLike } from "@/lib/env/EnvLike";
import { OFFICE_LANDING_VISIBLE } from "@/lib/marketing/officeLanding";

const DEFAULT_MARKETING_HOSTS = ["zampell.com.br", "www.zampell.com.br"] as const;
/** Origem dos links da vitrine quando `NEXT_PUBLIC_APP_URL` não está definido. */
export const CANONICAL_APP_ORIGIN = "https://app.zampell.com.br";

function bareHost(host: string): string {
    const withoutPort = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
    return withoutPort.startsWith("www.") ? withoutPort.slice(4) : withoutPort;
}

/** Hosts da vitrine. `MARKETING_HOSTS` separado por vírgula sobrescreve o padrão. */
export function marketingHostList(env: EnvLike = process.env): string[] {
    const raw = env.MARKETING_HOSTS?.trim();
    const list = raw ? raw.split(",") : [...DEFAULT_MARKETING_HOSTS];
    return list.map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function isMarketingHostname(host: string, env: EnvLike = process.env): boolean {
    const bare = bareHost(host);
    if (!bare) return false;
    return marketingHostList(env).some((item) => bareHost(item) === bare);
}

/** Origem do app (login, painel, cardápio). Sem barra no fim. */
export function appPublicOrigin(env: EnvLike = process.env): string {
    const raw = env.NEXT_PUBLIC_APP_URL?.trim() || CANONICAL_APP_ORIGIN;
    return raw.replace(/\/$/, "");
}

/** Página interna da oferta de atendimento. `/atendimento` no app já é o painel. */
export const ATTENDANCE_PAGE_PATH = "/agente";

/** URL pública na vitrine. O host de marketing reescreve isto para `/agente`. */
export const ATTENDANCE_MARKETING_PATH = "/atendimento";

export function attendanceLandingHref(onMarketingHost: boolean): string {
    return onMarketingHost ? ATTENDANCE_MARKETING_PATH : ATTENDANCE_PAGE_PATH;
}

export function deliveryLandingHref(onMarketingHost: boolean): string {
    return onMarketingHost ? "/" : "/inicio";
}

/** No host da vitrine, o link de conta abre no app. No próprio app, continua relativo. */
export function accountHref(
    path: string,
    onMarketingHost: boolean,
    env: EnvLike = process.env
): string {
    const withSlash = path.startsWith("/") ? path : `/${path}`;
    if (!onMarketingHost) return withSlash;
    return `${appPublicOrigin(env)}${withSlash}`;
}

export type MarketingHostAction =
    | { type: "ignore" }
    | { type: "next" }
    | { type: "rewrite"; pathname: string }
    | { type: "redirect" }
    | { type: "redirect-local"; pathname: string }
    | { type: "deny" };

function isMarketingAsset(pathname: string): boolean {
    return (
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico" ||
        pathname === "/robots.txt" ||
        pathname === "/manifest.webmanifest" ||
        pathname.startsWith("/sw.js") ||
        pathname.startsWith("/workbox-") ||
        pathname.startsWith("/fallback-") ||
        pathname.startsWith("/icons/") ||
        pathname.startsWith("/brand/") ||
        pathname.startsWith("/assets/") ||
        pathname.startsWith("/marketing/loops/")
    );
}

function isMarketingReadApi(pathname: string): boolean {
    return (
        pathname === "/api/billing/public-plans" ||
        pathname === "/api/billing/trial-policy" ||
        pathname === "/api/public/site-chat" ||
        pathname === "/api/public/site-visit"
    );
}

/**
 * No host da vitrine: `/` vira a landing, assets e as APIs públicas seguem,
 * o resto da UI vai para o app e as outras APIs recusam o host.
 */
export function marketingHostAction(
    host: string,
    pathname: string,
    env: EnvLike = process.env
): MarketingHostAction {
    if (!isMarketingHostname(host, env)) return { type: "ignore" };
    if (isMarketingAsset(pathname) || isMarketingReadApi(pathname)) return { type: "next" };
    if (pathname === "/") return { type: "rewrite", pathname: "/inicio" };
    if (pathname === "/inicio" || pathname.startsWith("/inicio/")) return { type: "next" };
    if (pathname === "/chat" || pathname.startsWith("/chat/")) return { type: "next" };
    if (
        !OFFICE_LANDING_VISIBLE &&
        (pathname === "/atendimento" || pathname === "/agente" || pathname.startsWith("/agente/"))
    ) {
        return { type: "redirect-local", pathname: "/" };
    }
    if (pathname === "/agente" || pathname.startsWith("/agente/")) return { type: "next" };
    if (pathname === "/atendimento") return { type: "rewrite", pathname: "/agente" };
    if (pathname.startsWith("/api/")) return { type: "deny" };
    return { type: "redirect" };
}
