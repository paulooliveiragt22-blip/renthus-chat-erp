import { NextResponse } from "next/server";
import { appPublicOrigin } from "@/lib/marketing/hosts";
import { encryptCredential } from "@/lib/security/credentialCrypto";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { exchangeGoogleCode, googleAccountEmail } from "@/src/service/adapters/google/googleCalendarHttp";
import { parseGoogleOAuthState } from "@/src/service/adapters/google/googleOAuthState";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

function panel(code: string): NextResponse {
    const url = new URL("/agenda", appPublicOrigin());
    url.searchParams.set("google", code);
    return NextResponse.redirect(url);
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError === "access_denied") return panel("recusado");
    if (oauthError) return panel("erro");

    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return panel(ctx.status === 401 ? "login" : "erro");

    const code = url.searchParams.get("code")?.trim() ?? "";
    const parsed = parseGoogleOAuthState(url.searchParams.get("state")?.trim() ?? "");
    if (!code || !parsed || parsed.companyId !== ctx.companyId || parsed.userId !== ctx.userId) {
        return panel("erro");
    }

    try {
        const tokens = await exchangeGoogleCode(code);
        if (!tokens.ok) return panel(tokens.reason === "missing_scope" ? "escopo" : "erro");
        if (!tokens.refreshToken) return panel("sem_refresh");
        const email = await googleAccountEmail(tokens.accessToken);
        if (!email) return panel("erro");
        const enc = encryptCredential(tokens.refreshToken);
        if (!enc) return panel("sem_cliente");
        const saved = await callServiceRpc(ctx.admin, "rpc_service_google_connect", {
            p_company_id: ctx.companyId,
            p_email: email,
            p_refresh_token_enc: enc,
            p_calendar_id: "primary",
        });
        const body = saved.body && typeof saved.body === "object" ? (saved.body as { ok?: unknown }) : null;
        if (saved.status !== 200 || body?.ok !== true) return panel("erro");
        return panel("conectado");
    } catch (error: unknown) {
        const name = error instanceof Error ? error.name : "oauth_failed";
        console.error("[google-calendar/callback]", name);
        return panel("erro");
    }
}
