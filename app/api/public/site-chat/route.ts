import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceIpRateLimitAsync } from "@/lib/security/rateLimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSiteChat } from "@/src/service/adapters/site/siteChatRpc";
import { runSiteChatTurn } from "@/src/service/application/runSiteChatTurn";
import { ZAMPELL_SERVICE_COMPANY_ID } from "@/src/service/application/siteChatCompany";
import {
    SITE_CHAT_COOKIE,
    SITE_CHAT_IP_CAP_TEXT,
    SITE_CHAT_IP_LIMIT,
    SITE_CHAT_IP_WINDOW_MS,
    SITE_CHAT_MESSAGE_CAP,
} from "@/src/service/domain/siteChat";
import { siteChatPostSchema } from "@/src/service/http/schemas";

export const runtime = "nodejs";

const sessionIdSchema = z.string().uuid();

function sessionFromCookie(value: string | undefined): string | null {
    const parsed = sessionIdSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

function withSession(body: unknown, sessionId: string, status = 200): NextResponse {
    const response = NextResponse.json(body, { status });
    response.cookies.set(SITE_CHAT_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24,
    });
    return response;
}

export async function GET(req: Request) {
    const limited = await enforceIpRateLimitAsync(req, "site_chat_read", 120, SITE_CHAT_IP_WINDOW_MS, {
        messages: [],
        remaining: SITE_CHAT_MESSAGE_CAP,
    });
    if (limited) return limited;
    const sessionId = sessionFromCookie((await cookies()).get(SITE_CHAT_COOKIE)?.value);
    if (!sessionId) {
        return NextResponse.json({ messages: [], remaining: SITE_CHAT_MESSAGE_CAP });
    }
    try {
        const admin = createAdminClient();
        const read = await readSiteChat(admin, ZAMPELL_SERVICE_COMPANY_ID, sessionId);
        return NextResponse.json(read);
    } catch (error: unknown) {
        console.warn("[site-chat] read", error instanceof Error ? error.message : "failed");
        return NextResponse.json({ messages: [], remaining: SITE_CHAT_MESSAGE_CAP }, { status: 503 });
    }
}

export async function POST(req: Request) {
    const limited = await enforceIpRateLimitAsync(req, "site_chat", SITE_CHAT_IP_LIMIT, SITE_CHAT_IP_WINDOW_MS, {
        reply: SITE_CHAT_IP_CAP_TEXT,
        links: [],
        remaining: null,
    });
    if (limited) return limited;
    const parsed = siteChatPostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ reply: "Escreva uma mensagem curta.", links: [] }, { status: 400 });
    }
    const sessionId = sessionFromCookie((await cookies()).get(SITE_CHAT_COOKIE)?.value);
    let admin;
    try {
        admin = createAdminClient();
    } catch (error: unknown) {
        console.warn("[site-chat] admin", error instanceof Error ? error.message : "failed");
        return NextResponse.json({ reply: "Não consegui responder agora.", links: [] }, { status: 503 });
    }
    const result = await runSiteChatTurn(admin, {
        text: parsed.data.text,
        sessionId,
        reset: parsed.data.reset === true,
    });
    if (result.kind === "ok") {
        return withSession(
            { reply: result.reply, links: result.links, remaining: result.remaining },
            result.sessionId
        );
    }
    if (result.kind === "session_cap") {
        return withSession(
            { reply: result.reply, links: [], remaining: 0 },
            result.sessionId,
            429
        );
    }
    if (result.kind === "invalid") {
        return NextResponse.json({ reply: "Escreva uma mensagem curta.", links: [] }, { status: 400 });
    }
    if (result.kind === "retry") {
        return NextResponse.json({ reply: "Não consegui responder agora. Tente de novo em instantes.", links: [] }, { status: 503 });
    }
    return NextResponse.json({ reply: "Não consegui responder agora.", links: [] }, { status: 503 });
}
