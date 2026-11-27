import { NextResponse } from "next/server";
import { appPublicOrigin } from "@/lib/marketing/hosts";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { googleAuthorizeUrl, googleCalendarConfigured } from "@/src/service/adapters/google/googleCalendarHttp";
import { createGoogleOAuthState } from "@/src/service/adapters/google/googleOAuthState";

export const runtime = "nodejs";

function panel(code: string): NextResponse {
    const url = new URL("/atendimento", appPublicOrigin());
    url.searchParams.set("google", code);
    return NextResponse.redirect(url);
}

export async function GET() {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return panel(ctx.status === 401 ? "login" : "erro");
    if (!googleCalendarConfigured()) return panel("sem_cliente");
    try {
        const state = createGoogleOAuthState(ctx.companyId, ctx.userId);
        return NextResponse.redirect(googleAuthorizeUrl(state));
    } catch {
        return panel("erro");
    }
}
