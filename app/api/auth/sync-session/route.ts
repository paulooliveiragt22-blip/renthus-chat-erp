import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

/**
 * Grava sessão nos cookies a partir de access/refresh token.
 * Cookies são setados no cookie store E na NextResponse — necessário para o
 * browser (e Playwright) receber Set-Cookie de forma confiável.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        const { access_token, refresh_token } = body ?? {};

        if (!access_token || !refresh_token) {
            return NextResponse.json(
                { error: "access_token and refresh_token are required" },
                { status: 400 }
            );
        }

        const cookieStore = await cookies();
        const response = NextResponse.json({ ok: true });

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },
                    setAll(cookiesToSet) {
                        for (const { name, value, options } of cookiesToSet) {
                            cookieStore.set(name, value, options);
                            response.cookies.set(name, value, options);
                        }
                    },
                },
            }
        );

        const { error } = await supabase.auth.setSession({ access_token, refresh_token });

        if (error) {
            console.error("auth.setSession error:", error);
            return NextResponse.json(
                { error: error.message || "Failed to set session" },
                { status: 400 }
            );
        }

        return response;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Internal error";
        console.error("Server error in auth/sync-session:", err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
