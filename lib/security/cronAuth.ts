import { NextResponse } from "next/server";

/**
 * Enforce CRON_SECRET in production and validate Bearer auth header.
 */
export function validateCronAuthorization(authHeader: string | null): NextResponse | null {
    const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

    if (isProd && !cronSecret) {
        console.error("[cron] CRON_SECRET ausente em ambiente de produção.");
        return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    if (!cronSecret) return null; // local/dev convenience
    if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return null;
}
