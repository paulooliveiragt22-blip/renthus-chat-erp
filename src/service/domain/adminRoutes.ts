import type { AttendanceMode } from "./types";

const DELIVERY_PREFIXES = [
    "/pedidos",
    "/fila",
    "/pdv",
    "/mesa",
    "/produtos",
    "/estoque",
    "/entregadores",
    "/impressoras",
] as const;

const SERVICE_PREFIXES = ["/atendimento", "/ofertas", "/agenda", "/cards"] as const;

function matches(pathname: string, prefixes: readonly string[]): boolean {
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function adminRouteBlocked(mode: AttendanceMode, pathname: string): boolean {
    if (mode === "service" && matches(pathname, DELIVERY_PREFIXES)) return true;
    if (mode === "delivery" && matches(pathname, SERVICE_PREFIXES)) return true;
    return false;
}

export function isModeGatedAdminPath(pathname: string): boolean {
    return matches(pathname, DELIVERY_PREFIXES) || matches(pathname, SERVICE_PREFIXES);
}
