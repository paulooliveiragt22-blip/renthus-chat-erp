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
    if (pathname.startsWith("/api/billing/webhook")) return NextResponse.next();
    if (pathname === "/api/billing/signup") return NextResponse.next();
    if (pathname === "/api/billing/create-invoice-checkout") return NextResponse.next();
    // Auth do print agent — chamado pelo Electron sem cookies de sessão
    if (pathname === "/api/agent/auth") return NextResponse.next();

    // Rotas públicas (não exigem login)
    const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/billing/blocked") ||
        pathname.startsWith("/signup") ||
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

    // Verifica se a empresa está bloqueada por inadimplência
    // Aplica apenas em rotas de painel (não em API calls)
    if (!pathname.startsWith("/api/")) {
        const companyId = request.cookies.get("renthus_company_id")?.value;

        if (companyId) {
            const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
            const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

            try {
                const subRes = await fetch(
                    `${supabaseUrl}/rest/v1/pagarme_subscriptions` +
                    `?company_id=eq.${encodeURIComponent(companyId)}&select=status&limit=1`,
                    {
                        headers: {
                            Authorization: `Bearer ${serviceKey}`,
                            apikey:        serviceKey,
                        },
                    }
                );

                if (subRes.ok) {
                    const [sub] = (await subRes.json()) as Array<{ status: string }>;
                    if (sub?.status === "blocked") {
                        const blockedUrl = request.nextUrl.clone();
                        blockedUrl.pathname = "/billing/blocked";
                        return NextResponse.redirect(blockedUrl);
                    }
                }
            } catch {
                // Falha silenciosa — não bloqueia acesso em caso de erro de rede
            }
        }
    }

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
