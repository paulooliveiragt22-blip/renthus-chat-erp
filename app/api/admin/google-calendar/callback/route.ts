import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptCredential } from "@/lib/security/credentialCrypto";
import { exchangeGoogleCode, googleAccountEmail } from "@/src/service/adapters/google/googleCalendarHttp";
import { parseGoogleOAuthState } from "@/src/service/adapters/google/googleOAuthState";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

function done(req: Request, code: string): NextResponse {
    const url = new URL("/oauth/google-done", req.url);
    url.searchParams.set("google", code);
    return NextResponse.redirect(url);
}

async function memberStillActive(companyId: string, userId: string): Promise<boolean> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from("company_users")
        .select("is_active")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle();
    return !error && data != null && data.is_active !== false;
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError === "access_denied") return done(req, "recusado");
    if (oauthError) return done(req, "erro");

    const code = url.searchParams.get("code")?.trim() ?? "";
    const parsed = parseGoogleOAuthState(url.searchParams.get("state")?.trim() ?? "");
    if (!code || !parsed) return done(req, "erro");

    try {
        if (!(await memberStillActive(parsed.companyId, parsed.userId))) return done(req, "erro");
        const tokens = await exchangeGoogleCode(code);
        if (!tokens.ok) return done(req, tokens.reason === "missing_scope" ? "escopo" : "erro");
        if (!tokens.refreshToken) return done(req, "sem_refresh");
        const email = await googleAccountEmail(tokens.accessToken);
        if (!email) return done(req, "erro");
        const enc = encryptCredential(tokens.refreshToken);
        if (!enc) return done(req, "sem_cliente");
        const admin = createAdminClient();
        const saved = await callServiceRpc(admin, "rpc_service_google_connect", {
            p_company_id: parsed.companyId,
            p_email: email,
            p_refresh_token_enc: enc,
            p_calendar_id: "primary",
        });
        const body = saved.body && typeof saved.body === "object" ? (saved.body as { ok?: unknown }) : null;
        if (saved.status !== 200 || body?.ok !== true) return done(req, "erro");
        return done(req, "conectado");
    } catch (error: unknown) {
        const name = error instanceof Error ? error.name : "oauth_failed";
        console.error("[google-calendar/callback]", name);
        return done(req, "erro");
    }
}
