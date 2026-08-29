import type { NextResponse } from "next/server";
import { jsonError, type ApiErrorBody } from "@/lib/api/errors";

export type CronAuthOptions = {
    /** Header `x-vercel-cron` enviado pelo Vercel Cron (valor `"1"`). Informativo — não substitui Bearer. */
    vercelCronHeader?: string | null;
};

/**
 * Enforce CRON_SECRET in production and validate Bearer auth header.
 *
 * Vercel Cron (`vercel.json` → `crons`): envia `Authorization: Bearer ${CRON_SECRET}`
 * e `x-vercel-cron: 1`. Crons externos (cron-job.org) usam só Bearer — ambos válidos.
 * Nunca autenticar apenas por `x-vercel-cron` (header spoofável sem secret).
 */
export function validateCronAuthorization(
    authHeader: string | null,
    opts?: CronAuthOptions
): NextResponse<ApiErrorBody> | null {
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

    if (opts?.vercelCronHeader === "1") {
        // Telemetria: invocação via Vercel Cron (ver docs/SECURITY_SERVICE_ROLE_FLOWS.md).
    }

    return null;
}
