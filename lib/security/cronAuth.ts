import type { NextResponse } from "next/server";
import { jsonError, type ApiErrorBody } from "@/lib/api/errors";

/**
 * Enforce CRON_SECRET in production and validate Bearer auth header.
 */
export function validateCronAuthorization(authHeader: string | null): NextResponse<ApiErrorBody> | null {
    const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

    if (isProd && !cronSecret) {
        console.error("[cron] CRON_SECRET ausente em ambiente de produção.");
        return jsonError("server_misconfigured", "CRON_SECRET ausente em produção.", 500);
    }

    if (!cronSecret) return null; // local/dev convenience
    if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonError("unauthorized", "Não autorizado.", 401);
    }
    return null;
}
