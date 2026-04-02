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

    // ── Superadmin — apenas local (bloqueado em produção Vercel) ──────────────
    if (pathname.startsWith("/superadmin") || pathname.startsWith("/api/superadmin/")) {
        if (process.env.VERCEL_ENV) {
            return NextResponse.rewrite(new URL("/404", request.url));
        }
        if (pathname === "/superadmin/login" || pathname === "/api/superadmin/login") return NextResponse.next();
        const token  = request.cookies.get("sa_token")?.value;
        const secret = process.env.SUPERADMIN_SECRET;
        if (!secret || token !== secret) {
            const url = request.nextUrl.clone();
            url.pathname = "/superadmin/login";
            return NextResponse.redirect(url);
        }
        return NextResponse.next();
    }

    // Libera webhooks e endpoints técnicos sem autenticação
    if (pathname.startsWith("/api/whatsapp/")) return NextResponse.next();
    if (pathname.startsWith("/api/print/")) return NextResponse.next();
    if (pathname.startsWith("/api/billing/webhook")) return NextResponse.next();
    if (pathname === "/api/billing/signup") return NextResponse.next();
    if (pathname === "/api/agent/auth" || pathname === "/api/agent/heartbeat") return NextResponse.next();
    // API pública de onboarding (GET por token — sem session)
    if (pathname === "/api/signup/complete") return NextResponse.next();

    // Rotas públicas (não exigem login)
    const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/billing/blocked") ||
        pathname.startsWith("/signup") ||    // inclui /signup, /signup/complete
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico";

    if (isPublic) return NextResponse.next();

    const response = NextResponse.next();

    // Cria client server-side
    const supabase = (options?.createClient ?? createServerClient)(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll: (cookiesToSet) => {
                    cookiesToSet.forEach(({ name, value, options: o }) => {
                        response.cookies.set(name, value, o);
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

    // ── Checks para usuários logados (somente rotas de painel, não API) ──
    if (!pathname.startsWith("/api/")) {
        const companyId    = request.cookies.get("renthus_company_id")?.value;
        const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

        if (companyId) {
            try {
                // Busca status da subscription + dados de onboarding de uma vez
                const [subRes, compRes] = await Promise.all([
                    fetch(
                        `${supabaseUrl}/rest/v1/pagarme_subscriptions` +
                        `?company_id=eq.${encodeURIComponent(companyId)}&select=status&limit=1`,
                        { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
                    ),
                    fetch(
                        `${supabaseUrl}/rest/v1/companies` +
                        `?id=eq.${encodeURIComponent(companyId)}` +
                        `&select=senha_definida,onboarding_completed_at,onboarding_token,is_active&limit=1`,
                        { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
                    ),
                ]);

                const [sub] = subRes.ok
                    ? ((await subRes.json()) as Array<{ status: string }>)
                    : [];
                const [comp] = compRes.ok
                    ? ((await compRes.json()) as Array<{
                          senha_definida:          boolean;
                          onboarding_completed_at: string | null;
                          onboarding_token:        string | null;
                          is_active:               boolean;
                      }>)
                    : [];

                // 1. Cobrança / bloqueio — alinhar subscription blocked com companies.is_active=false + overdue (ex.: falha parcial)
                const billingPaywall =
                    sub?.status === "blocked" ||
                    (comp && comp.is_active === false && sub?.status === "overdue");
                if (billingPaywall) {
                    const isConfig =
                        pathname === "/configuracoes" || pathname.startsWith("/configuracoes/");
                    if (!isConfig) {
                        const payUrl = request.nextUrl.clone();
                        payUrl.pathname = "/configuracoes";
                        payUrl.search    = "?tab=plano";
                        return NextResponse.redirect(payUrl);
                    }
                }

                // 2. Senha ainda não definida → completar cadastro
                if (comp) {
                    if (comp.senha_definida === false && comp.onboarding_token) {
                        const completeUrl = request.nextUrl.clone();
                        completeUrl.pathname = "/signup/complete";
                        completeUrl.search   = `?token=${comp.onboarding_token}`;
                        return NextResponse.redirect(completeUrl);
                    }

                    // 3. Onboarding ainda não concluído → redireciona para /onboarding
                    if (comp.onboarding_completed_at === null &&
                        pathname !== "/onboarding") {
                        const onboardUrl = request.nextUrl.clone();
                        onboardUrl.pathname = "/onboarding";
                        onboardUrl.search   = "";
                        return NextResponse.redirect(onboardUrl);
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
