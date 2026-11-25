import { adminRouteBlocked } from "@/src/service/domain/adminRoutes";
import type { AttendanceMode } from "@/src/service/domain/types";

export function loginDestination(mode: AttendanceMode, redirectTo: string): string {
    const raw = redirectTo.startsWith("/") ? redirectTo : "/pedidos";
    const path = raw.split("?")[0] || "/pedidos";
    if (mode === "service" && adminRouteBlocked("service", path)) return "/atendimento";
    if (mode === "delivery" && adminRouteBlocked("delivery", path)) return "/pedidos";
    return raw;
}

export function profileLabel(mode: AttendanceMode): string {
    return mode === "service" ? "Serviço" : "Delivery";
}
