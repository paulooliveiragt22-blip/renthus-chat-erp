import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // ✅ Libera webhooks (Twilio/WhatsApp) e endpoints técnicos
    // (Twilio precisa acessar sem autenticação)
    if (pathname.startsWith("/api/whatsapp/")) {
        return NextResponse.next();
    }

    // ✅ (Opcional) Libera fila de impressão / agentes
    // Se você criar endpoints como /api/print/pull etc., evita bloqueio pelo middleware
    if (pathname.startsWith("/api/print/")) {
        return NextResponse.next();
    }

    // ✅ Rotas públicas (não exigem login)
    const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico";

    // Para rotas públicas, não precisa bater no Supabase (economiza e evita latência)
    if (isPublic) {
        return NextResponse.next();
    }

    const response = NextResponse.next();

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll: (cookiesToSet) => {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options);
                    });
                },
            },
        }
    );

    const { data } = await supabase.auth.getUser();
    const isLoggedIn = !!data.user;

    if (!isLoggedIn) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
    }

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
