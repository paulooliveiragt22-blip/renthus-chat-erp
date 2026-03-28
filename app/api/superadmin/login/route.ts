import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    const { password } = await req.json().catch(() => ({}));
    const secret = process.env.SUPERADMIN_SECRET;

    console.log("[sa/login] secret defined:", !!secret, "| password match:", password === secret);

    if (!secret) {
        return NextResponse.json({ error: "SUPERADMIN_SECRET não configurado" }, { status: 500 });
    }

    if (password !== secret) {
        return NextResponse.json({ error: "Senha incorreta" }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set("sa_token", secret, {
        httpOnly: true,
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
