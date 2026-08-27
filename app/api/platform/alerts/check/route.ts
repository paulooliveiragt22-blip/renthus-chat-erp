/**
 * Cron / monitor: avalia alertas platform e reporta ao Sentry quando há critical/warning.
 * Auth: Bearer CRON_SECRET (mesmo padrão process-queue).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { evaluatePlatformAlerts } from "@/lib/platform/services/platformAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const denied = validateCronAuthorization(request.headers.get("authorization"));
    if (denied) return denied;

    const admin = createAdminClient();
    const result = await evaluatePlatformAlerts(admin);
    const firing = result.alerts.filter((a) => a.severity === "critical" || a.severity === "warning");

    if (firing.length > 0) {
        try {
            const Sentry = await import("@sentry/nextjs");
            for (const alert of firing) {
                Sentry.captureMessage(`[platform.alert] ${alert.title}`, {
                    level: alert.severity === "critical" ? "error" : "warning",
                    tags: {
                        platform_alert: alert.code,
                        route: "/api/platform/alerts/check",
                    },
                    extra: {
                        detail: alert.detail,
                        metadata: alert.metadata,
                        generatedAt: result.generatedAt,
                    },
                });
            }
        } catch {
            console.error("[platform/alerts/check]", firing.map((a) => a.code).join(","));
        }
    }

    return NextResponse.json({
        ok: result.ok,
        firing: firing.length,
        alerts: firing,
        generatedAt: result.generatedAt,
    });
}
