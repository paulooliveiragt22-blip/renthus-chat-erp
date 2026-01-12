// middleware.ts
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

type AuthClient = {
    auth: {
        getUser: () => Promise<{ data: { user: unknown } }>;
    };
};

export type SupabaseClientFactory = (
    supabaseUrl: string,
    supabaseKey: string,
    options: Parameters<typeof createServerClient>[2]
) => AuthClient;

export async function middleware(
    request: NextRequest,
    _event?: NextFetchEvent,
    options?: { createClient?: SupabaseClientFactory }
) {
    const pathname = request.nextUrl.pathname;

    // Libera webhooks e endpoints técnicos sem autenticação
    if (pathname.startsWith("/api/whatsapp/")) return NextResponse.next();
    if (pathname.startsWith("/api/print/")) return NextResponse.next();

    // Rotas públicas (não exigem login)
    const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico";

    if (isPublic) return NextResponse.next();

    const response = NextResponse.next();

    // cria client server-side usando cookies do request -> response (para setar cookies)
    const supabase = (options?.createClient ?? createServerClient)(
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
