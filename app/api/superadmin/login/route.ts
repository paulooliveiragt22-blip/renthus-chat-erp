import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

export async function POST(req: NextRequest) {
    const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? req.headers.get("x-real-ip")
        ?? "unknown";
    const rl = checkRateLimit(`superadmin_login:${ip}`, 30, 15 * 60_000);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "too_many_requests" },
            {
                status:      429,
                headers:     { "Retry-After": String(rl.retryAfterSeconds) },
            }
        );
    }

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
