// proxy.ts — convenção Next.js 16+ (substitui middleware.ts na raiz do projeto)
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

type SubscriptionStatusRow = { status: string };
type CompanyAccessRow = {
    senha_definida:          boolean;
    onboarding_completed_at: string | null;
    onboarding_token:        string | null;
    is_active:               boolean;
};

/** Redirecionamentos de cobrança / onboarding (extraído para reduzir complexidade cognitiva do proxy). */
async function redirectForCompanyAccess(
    request: NextRequest,
    pathname: string,
    companyId: string,
    supabaseUrl: string,
    serviceKey: string
): Promise<NextResponse | null> {
    try {
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

        const [sub] = subRes.ok ? ((await subRes.json()) as SubscriptionStatusRow[]) : [];
        const [comp] = compRes.ok ? ((await compRes.json()) as CompanyAccessRow[]) : [];

        const billingPaywall =
            sub?.status === "blocked" ||
            (comp?.is_active === false && sub?.status === "overdue");

        if (billingPaywall) {
            const isConfig = pathname === "/configuracoes" || pathname.startsWith("/configuracoes/");
            if (!isConfig) {
                const payUrl = request.nextUrl.clone();
                payUrl.pathname = "/configuracoes";
                payUrl.search    = "?tab=plano";
                return NextResponse.redirect(payUrl);
            }
        }

        if (comp) {
            if (comp.senha_definida === false && comp.onboarding_token) {
                const completeUrl = request.nextUrl.clone();
                completeUrl.pathname = "/signup/complete";
                completeUrl.search   = `?token=${comp.onboarding_token}`;
                return NextResponse.redirect(completeUrl);
            }

            if (comp.onboarding_completed_at === null && pathname !== "/onboarding") {
                const onboardUrl = request.nextUrl.clone();
                onboardUrl.pathname = "/onboarding";
                onboardUrl.search   = "";
                return NextResponse.redirect(onboardUrl);
            }
        }
    } catch {
        // Falha silenciosa — não bloqueia acesso em caso de erro de rede
    }
    return null;
}

function handleSuperadminBranch(request: NextRequest, pathname: string): NextResponse | null {
    if (!pathname.startsWith("/superadmin") && !pathname.startsWith("/api/superadmin/")) {
        return null;
    }
    if (process.env.VERCEL_ENV) {
        return NextResponse.rewrite(new URL("/404", request.url));
    }
    if (pathname === "/superadmin/login" || pathname === "/api/superadmin/login") {
        return NextResponse.next();
    }
    const token  = request.cookies.get("sa_token")?.value;
    const secret = process.env.SUPERADMIN_SECRET;
    if (!secret || token !== secret) {
        const url = request.nextUrl.clone();
        url.pathname = "/superadmin/login";
        return NextResponse.redirect(url);
    }
    return NextResponse.next();
}

function isTechnicalApiPublic(pathname: string): boolean {
    return (
        /** Webhook + Flows: chamados pela Meta sem cookie de sessão. Demais /api/whatsapp/* exigem login aqui. */
        pathname.startsWith("/api/whatsapp/incoming") ||
        pathname.startsWith("/api/whatsapp/flows") ||
        /** Worker da fila do chatbot usa autenticação própria via CRON_SECRET. */
        pathname.startsWith("/api/chatbot/process-queue") ||
        pathname.startsWith("/api/print/") ||
        pathname.startsWith("/api/billing/webhook") ||
        pathname === "/api/billing/signup" ||
        /** Print agent (api_key nas rotas) + painel /api/agent/keys|settings (exige sessão na própria rota) */
        pathname.startsWith("/api/agent/") ||
        pathname === "/api/signup/complete"
    );
}

function isPublicAppRoute(pathname: string): boolean {
    return (
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/billing/blocked") ||
        pathname.startsWith("/signup") ||
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico"
    );
}

export async function proxy(
    request: NextRequest,
    _event?: NextFetchEvent,
    options?: { createClient?: SupabaseClientFactory }
) {
    const pathname = request.nextUrl.pathname;

    const superRes = handleSuperadminBranch(request, pathname);
    if (superRes) return superRes;

    if (isTechnicalApiPublic(pathname)) return NextResponse.next();
    if (isPublicAppRoute(pathname)) return NextResponse.next();

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
        const companyId   = request.cookies.get("renthus_company_id")?.value;
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

        if (companyId) {
            const guardRedirect = await redirectForCompanyAccess(
                request,
                pathname,
                companyId,
                supabaseUrl,
                serviceKey
            );
            if (guardRedirect) return guardRedirect;
        }
    }

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
