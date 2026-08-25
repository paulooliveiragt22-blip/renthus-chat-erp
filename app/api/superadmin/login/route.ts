import { NextRequest, NextResponse } from "next/server";
import {
    enforceIpRateLimitAsync,
    RATE_LIMIT_WINDOW_15M_MS,
} from "@/lib/security/rateLimit";

export async function POST(req: NextRequest) {
    const limited = await enforceIpRateLimitAsync(
        req,
        "superadmin_login",
        30,
        RATE_LIMIT_WINDOW_15M_MS,
        { error: "too_many_requests" }
    );
    if (limited) return limited;

    const { password } = await req.json().catch(() => ({}));
    const secret = process.env.SUPERADMIN_SECRET;

    if (!secret) {
        return NextResponse.json({ error: "SUPERADMIN_SECRET não configurado" }, { status: 500 });
    }

    if (password !== secret) {
        return NextResponse.json({ error: "Senha incorreta" }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
    res.cookies.set("sa_token", secret, {
        httpOnly: true,
        secure:   isProd,
        sameSite: "lax",
        path:     "/",
        maxAge:   60 * 60 * 24 * 7, // 7 dias
    });
    return res;
}

export async function DELETE() {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete("sa_token");
    return res;
}
