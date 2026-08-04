/**
 * Cron F4.1: sync automático de catálogo marketplace (iFood / Aiqfome).
 * Vercel Hobby: 1x/dia (`0 4 * * *` em vercel.json). Pro/externo pode chamar
 * com mais frequência; cada conexão respeita sync_interval_hours (1–6).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { runMarketplaceCatalogCron } from "@/src/marketplaces/services/runMarketplaceCatalogCron";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
    const authError = validateCronAuthorization(req.headers.get("authorization"));
    if (authError) return authError;

    const admin = createAdminClient();
    const t0 = Date.now();
    const result = await runMarketplaceCatalogCron(admin);

    return NextResponse.json({
        ok: result.errors.length === 0,
        ...result,
        durationMs: Date.now() - t0,
    });
}
