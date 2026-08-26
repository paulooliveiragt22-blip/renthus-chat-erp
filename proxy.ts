// proxy.ts — convenção Next.js 16+ (substitui middleware.ts na raiz do projeto)
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
    lookupMenuSlugByHostViaRest,
    resolveMenuHostRewrite,
} from "@/lib/public-menu/menuHostRewrite";

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

/** TTL curto: evita 2 REST a cada navegação admin; billing/onboarding ainda revalida rápido. */
const ACCESS_GUARD_COOKIE = "renthus_access_ok";
const ACCESS_GUARD_TTL_MS = 45_000;

function accessGuardFresh(request: NextRequest, companyId: string): boolean {
    const raw = request.cookies.get(ACCESS_GUARD_COOKIE)?.value;
    if (!raw) return false;
    const sep = raw.lastIndexOf(":");
    if (sep <= 0) return false;
    const cid = raw.slice(0, sep);
    const ts = Number(raw.slice(sep + 1));
    if (cid !== companyId || !Number.isFinite(ts)) return false;
    return Date.now() - ts < ACCESS_GUARD_TTL_MS;
}

function stampAccessGuard(response: NextResponse, companyId: string): void {
    response.cookies.set(ACCESS_GUARD_COOKIE, `${companyId}:${Date.now()}`, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: Math.ceil(ACCESS_GUARD_TTL_MS / 1000) + 5,
        secure: process.env.NODE_ENV === "production",
    });
}

type AccessGuardResult =
    | { type: "fresh" }
    | { type: "allow" }
    | { type: "redirect"; response: NextResponse };

/** Redirecionamentos de cobrança / onboarding (extraído para reduzir complexidade cognitiva do proxy). */
async function checkCompanyAccess(
    request: NextRequest,
    pathname: string,
    companyId: string,
    supabaseUrl: string,
    serviceKey: string
): Promise<AccessGuardResult> {
    if (accessGuardFresh(request, companyId)) return { type: "fresh" };

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
                payUrl.search = "?tab=plano";
                return { type: "redirect", response: NextResponse.redirect(payUrl) };
            }
        }

        if (comp) {
            if (comp.senha_definida === false && comp.onboarding_token) {
                const completeUrl = request.nextUrl.clone();
                completeUrl.pathname = "/signup/complete";
                completeUrl.search = `?token=${comp.onboarding_token}`;
                return { type: "redirect", response: NextResponse.redirect(completeUrl) };
            }

            if (comp.onboarding_completed_at === null && pathname !== "/onboarding") {
                const onboardUrl = request.nextUrl.clone();
                onboardUrl.pathname = "/onboarding";
                onboardUrl.search = "";
                return { type: "redirect", response: NextResponse.redirect(onboardUrl) };
            }
        }

        return { type: "allow" };
    } catch {
        // Falha silenciosa — não bloqueia acesso em caso de erro de rede
    }
    return { type: "allow" };
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
        /** Webhook Meta: chamado sem cookie de sessão. Demais /api/whatsapp/* exigem login aqui. */
        pathname.startsWith("/api/whatsapp/incoming") ||
        /**
         * Rotas de scheduler do chatbot: autenticação própria via Bearer CRON_SECRET
         * (`validateCronAuthorization`). Não incluir `/api/chatbot/*` por prefixo —
         * `config` e `resolve` dependem da sessão validada aqui.
         */
        pathname.startsWith("/api/chatbot/process-queue") ||
        pathname.startsWith("/api/chatbot/reactivate") ||
        pathname.startsWith("/api/chatbot/detect-abandoned-carts") ||
        pathname.startsWith("/api/chatbot/outbound-worker") ||
        /** Cron sync catálogo marketplace (F4.1) — Bearer CRON_SECRET. */
        pathname.startsWith("/api/marketplace/sync-catalog") ||
        /**
         * Cron diário de cobrança (Vercel, sem cookie de sessão) — autentica via
         * `validateCronAuthorization` (Bearer CRON_SECRET) dentro da própria rota.
         * Faltava aqui: o proxy redirecionava pra /login antes do handler rodar.
         */
        pathname.startsWith("/api/billing/charge") ||
        pathname.startsWith("/api/print/") ||
        pathname.startsWith("/api/billing/webhook") ||
        pathname === "/api/billing/signup" ||
        /** Webhook Meta Page/Instagram Messaging: assinatura própria (X-Hub-Signature-256), sem cookie. */
        pathname.startsWith("/api/meta/messaging/incoming") ||
        /** Print agent (api_key nas rotas) + painel /api/agent/keys|settings (exige sessão na própria rota) */
        pathname.startsWith("/api/agent/") ||
        pathname === "/api/signup/complete" ||
        /**
         * Estabelece/encerra sessão a partir de tokens no body.
         * Sem isto, o proxy manda /api/auth/sync-session → /login (HTML) quando ainda
         * não há cookie — o login “funciona” no Chrome só porque createBrowserClient
         * já gravou cookie no signIn; E2E/API puro quebra.
         */
        pathname === "/api/auth/sync-session" ||
        pathname === "/api/auth/signout" ||
        /** Cardápio web público (rate limit nas próprias rotas). */
        pathname.startsWith("/api/public/") ||
        /** Health check pra monitor externo de uptime — sem cookie de sessão. */
        pathname === "/api/health"
    );
}

function isPublicAppRoute(pathname: string): boolean {
    return (
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/billing/blocked") ||
        pathname.startsWith("/signup") ||
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/c/") ||
        pathname === "/c" ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico" ||
        /** PWA: Chrome/Safari/Android validam estes assets sem cookie de sessão. */
        pathname === "/manifest.webmanifest" ||
        pathname === "/sw.js" ||
        pathname.startsWith("/sw.js") ||
        pathname.startsWith("/workbox-") ||
        pathname.startsWith("/fallback-") ||
        pathname.startsWith("/icons/") ||
        pathname === "/offline" ||
        pathname.startsWith("/offline/")
    );
}

export async function proxy(
    request: NextRequest,
    _event?: NextFetchEvent,
    options?: { createClient?: SupabaseClientFactory }
) {
    const pathname = request.nextUrl.pathname;

    // F4.3: subdomínio / domínio próprio → /c/{slug}
    const hostHeader =
        request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const hostRewrite = await resolveMenuHostRewrite({
        host: hostHeader,
        pathname,
        lookupCustomDomainSlug:
            supabaseUrl && serviceKey
                ? (host) =>
                      lookupMenuSlugByHostViaRest({
                          host,
                          supabaseUrl,
                          serviceKey,
                      })
                : undefined,
    });
    if (hostRewrite.rewrite) {
        const url = request.nextUrl.clone();
        url.pathname = hostRewrite.pathname;
        return NextResponse.rewrite(url);
    }

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
            const guard = await checkCompanyAccess(
                request,
                pathname,
                companyId,
                supabaseUrl,
                serviceKey
            );
            if (guard.type === "redirect") return guard.response;
            if (guard.type === "allow") stampAccessGuard(response, companyId);
        }
    }

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
