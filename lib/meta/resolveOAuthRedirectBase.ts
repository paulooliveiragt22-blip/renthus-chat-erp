import type { EnvLike } from "@/lib/env/EnvLike";
import { resolvePublicAppBaseUrl } from "@/lib/public-menu/appBaseUrl";

/**
 * Base pública para redirect_uri do Facebook Login.
 * Prefere o Host da request (app.renthus.com.br) em vez de cair em VERCEL_URL
 * (*.vercel.app) quando NEXT_PUBLIC_APP_URL não está no runtime — causa clássica
 * de "URL bloqueada" na Meta.
 */
export function resolveOAuthRedirectBase(
    req: Request,
    env: EnvLike = process.env
): string {
    const fallback = resolvePublicAppBaseUrl(env);
    const host = (
        req.headers.get("x-forwarded-host") ||
        req.headers.get("host") ||
        ""
    )
        .split(",")[0]
        ?.trim()
        .toLowerCase();
    if (!host) return fallback;

    const allowed = new Set<string>();
    try {
        allowed.add(new URL(fallback).host.toLowerCase());
    } catch {
        /* ignore invalid fallback */
    }
    allowed.add("app.renthus.com.br");
    allowed.add("www.renthus.com.br");
    allowed.add("localhost:3000");
    allowed.add("127.0.0.1:3000");

    const vercel = env.VERCEL_URL?.trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "")
        .toLowerCase();
    if (vercel) allowed.add(vercel);

    if (!allowed.has(host)) return fallback;

    const forwardedProto = (
        req.headers.get("x-forwarded-proto") || ""
    )
        .split(",")[0]
        ?.trim()
        .toLowerCase();
    const isLocal = host.startsWith("localhost") || host.startsWith("127.");
    const scheme = isLocal ? "http" : forwardedProto || "https";
    return `${scheme}://${host}`;
}
