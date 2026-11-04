import type { EnvLike } from "@/lib/env/EnvLike";
import { isMarketingHostname } from "@/lib/marketing/hosts";

/** Rotas que renderizam sozinhas, sem sidebar nem header do admin. */
export function isAdminShellStandalone(
    pathname: string,
    host = "",
    env: EnvLike = process.env
): boolean {
    if (host && isMarketingHostname(host, env)) return true;
    return (
        pathname === "/login" ||
        pathname === "/billing/blocked" ||
        pathname.startsWith("/signup") ||
        pathname === "/inicio" ||
        pathname.startsWith("/inicio/") ||
        pathname.startsWith("/onboarding") ||
        pathname === "/ativar" ||
        pathname.startsWith("/ativar/") ||
        pathname === "/plano/pagar" ||
        pathname === "/plano/bloqueado" ||
        pathname === "/plano/reativar" ||
        pathname === "/logout" ||
        pathname.startsWith("/c/") ||
        pathname === "/c" ||
        pathname.startsWith("/superadmin") ||
        pathname.startsWith("/platform")
    );
}
