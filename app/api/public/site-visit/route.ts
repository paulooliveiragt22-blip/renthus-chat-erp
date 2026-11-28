import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceIpRateLimitAsync } from "@/lib/security/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { ZAMPELL_SERVICE_COMPANY_ID } from "@/src/service/application/siteChatCompany";
import { SITE_VISITOR_COOKIE, SITE_VISIT_PATH } from "@/src/service/domain/siteAudience";
import { SITE_CHAT_IP_WINDOW_MS } from "@/src/service/domain/siteChat";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

const visitorSchema = z.string().uuid();
const VISIT_LIMIT = 30;
const VISITOR_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function visitorFromCookie(value: string | undefined): string | null {
    const parsed = visitorSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

function withVisitor(body: unknown, visitorKey: string, status = 200): NextResponse {
    const response = NextResponse.json(body, { status });
    response.cookies.set(SITE_VISITOR_COOKIE, visitorKey, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: VISITOR_MAX_AGE_SECONDS,
    });
    return response;
}

export async function POST(req: Request) {
    const limited = await enforceIpRateLimitAsync(req, "site_visit", VISIT_LIMIT, SITE_CHAT_IP_WINDOW_MS, {
        error: "rate_limit_exceeded",
    });
    if (limited) return limited;

    const existing = visitorFromCookie((await cookies()).get(SITE_VISITOR_COOKIE)?.value);
    const visitorKey = existing ?? crypto.randomUUID();
    try {
        const result = await callServiceRpc(createAdminClient(), "rpc_site_visit_record", {
            p_company_id: ZAMPELL_SERVICE_COMPANY_ID,
            p_visitor_key: visitorKey,
            p_path: SITE_VISIT_PATH,
        });
        return withVisitor(result.body, visitorKey, result.status);
    } catch {
        return withVisitor({ ok: false, code: "visit_failed" }, visitorKey, 500);
    }
}
