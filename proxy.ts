// proxy.ts — convenção Next.js 16+ (substitui middleware.ts na raiz do projeto)
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "crypto";
import { isIpAllowed, collectClientIpCandidates } from "@/lib/platform/checkPlatformIpAllowlist";
import {
    getPlatformAdminHost,
    isPlatformDedicatedHostRequest,
    platformAdminCanonicalUrl,
    resolveRequestHostname,
} from "@/lib/platform/resolvePlatformRequestHost";
import {
    PLATFORM_IMPERSONATION_COOKIE,
    isMutatingHttpMethod,
    isTenantMutationPath,
} from "@/lib/platform/impersonation";
import {
    lookupMenuSlugByHostViaRest,
    resolveMenuHostRewrite,
} from "@/lib/public-menu/menuHostRewrite";
import { resolveTenantAccess } from "@/lib/billing/tenantAccess";

type AuthClient = {
    auth: {
        getUser: () => Promise<{ data: { user: unknown } }>;
        mfa?: {
            getAuthenticatorAssuranceLevel: () => Promise<{
                data: { currentLevel: string | null; nextLevel: string | null } | null;
                error: unknown;
            }>;
        };
    };
};

export type SupabaseClientFactory = (
    supabaseUrl: string,
    supabaseKey: string,
    options: Parameters<typeof createServerClient>[2]
) => AuthClient;

type SubscriptionStatusRow = {
    status: string;
    trial_ends_at?: string | null;
    last_paid_at?: string | null;
    plan?: string | null;
};
type CompanyAccessRow = {
    senha_definida:          boolean;
    onboarding_completed_at: string | null;
    onboarding_token:        string | null;
    is_active:               boolean;
};

type AccessGuardResult = { type: "allow" } | { type: "redirect"; response: NextResponse };

/** Rotas permitidas enquanto billing paywall está ativo (P0.10). */
function isBillingPaywallAllowedPath(pathname: string, searchParams: URLSearchParams): boolean {
    if (pathname === "/logout" || pathname.startsWith("/logout/")) return true;
    if (pathname === "/plano" || pathname.startsWith("/plano/")) return true;
    if (pathname.startsWith("/oauth/")) return true;
    if (pathname === "/configuracoes" && searchParams.get("tab") === "plano") return true;
    if (pathname.startsWith("/configuracoes/") && searchParams.get("tab") === "plano") return true;
    return false;
}

function billingPaywallRedirect(request: NextRequest): NextResponse {
    const payUrl = request.nextUrl.clone();
    payUrl.pathname = "/plano/pagar";
    payUrl.search = "";
    return NextResponse.redirect(payUrl);
}

/** Redirecionamentos de cobrança / onboarding (extraído para reduzir complexidade cognitiva do proxy). */
async function checkCompanyAccess(
    request: NextRequest,
    pathname: string,
    companyId: string,
    supabaseUrl: string,
    serviceKey: string
): Promise<AccessGuardResult> {
    try {
        const [subRes, compRes] = await Promise.all([
            fetch(
                `${supabaseUrl}/rest/v1/pagarme_subscriptions` +
                    `?company_id=eq.${encodeURIComponent(companyId)}` +
                    `&select=status,trial_ends_at,last_paid_at,plan&limit=1`,
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

        const tenant = resolveTenantAccess(
            sub
                ? {
                      status: sub.status,
                      trial_ends_at: sub.trial_ends_at ?? null,
                      last_paid_at: sub.last_paid_at ?? null,
                      plan: sub.plan ?? null,
                  }
                : null
        );

        const billingPaywall = tenant.access === "deny";

        if (billingPaywall) {
            if (!isBillingPaywallAllowedPath(pathname, request.nextUrl.searchParams)) {
                return { type: "redirect", response: billingPaywallRedirect(request) };
            }
        }

        if (comp && !billingPaywall) {
            if (comp.onboarding_completed_at === null && pathname !== "/ativar" && pathname !== "/onboarding") {
                const onboardUrl = request.nextUrl.clone();
                onboardUrl.pathname = "/ativar";
                onboardUrl.search = "";
                return { type: "redirect", response: NextResponse.redirect(onboardUrl) };
            }
        }

        return { type: "allow" };
    } catch (err) {
        console.error("[proxy] checkCompanyAccess:", err);
        return { type: "redirect", response: billingPaywallRedirect(request) };
    }
}

/** Rotas tenant / APIs internas não devem ser servidas no host dedicado platform.* */
function handlePlatformDedicatedHost(
    request: NextRequest,
    pathname: string
): NextResponse | null {
    if (
        !isPlatformDedicatedHostRequest(
            request.headers,
            request.nextUrl.hostname
        )
    ) {
        return null;
    }

    if (
        pathname.startsWith("/platform") ||
        pathname.startsWith("/api/platform/")
    ) {
        return null;
    }

    if (
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico" ||
        pathname === "/manifest.webmanifest" ||
        pathname.startsWith("/sw.js") ||
        pathname.startsWith("/workbox-") ||
        pathname.startsWith("/fallback-") ||
        pathname.startsWith("/icons/") ||
        pathname.startsWith("/brand/") ||
        pathname.startsWith("/assets/") ||
        pathname === "/offline" ||
        pathname.startsWith("/offline/") ||
        isTechnicalApiPublic(pathname)
    ) {
        return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
        return NextResponse.json(
            { error: "Host not allowed", code: "host_not_allowed" },
            { status: 403 }
        );
    }

    const url = request.nextUrl.clone();
    if (pathname === "/login" || pathname.startsWith("/login/")) {
        url.pathname = "/platform/login";
    } else {
        url.pathname = "/platform";
        url.search = "";
    }
    return NextResponse.redirect(url, 307);
}

async function handlePlatformBranch(
    request: NextRequest,
    pathname: string,
    options?: { createClient?: SupabaseClientFactory }
): Promise<NextResponse | null> {
    if (!pathname.startsWith("/platform") && !pathname.startsWith("/api/platform/")) {
        return null;
    }

    const requestHeaders = new Headers(request.headers);
    if (!requestHeaders.get("x-request-id")) {
        requestHeaders.set("x-request-id", randomUUID());
    }

    // Página de diagnóstico do allowlist — sempre acessível (mesmo Host errado ajuda ops)
    if (pathname === "/platform/forbidden") {
        return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // Crons + impersonation status no host tenant (AdminShell banner em app.*)
    if (
        pathname === "/api/platform/alerts/check" ||
        pathname === "/api/platform/audit/archive" ||
        pathname === "/api/platform/impersonate"
    ) {
        return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // Host dedicado: UI redireciona para platform.*; API → 403
    const adminHost = getPlatformAdminHost();
    if (adminHost) {
        const reqHost =
            resolveRequestHostname(request.headers) ||
            request.nextUrl.hostname.toLowerCase();
        if (reqHost && reqHost !== adminHost) {
            if (pathname.startsWith("/api/")) {
                return NextResponse.json(
                    { error: "Host not allowed", code: "host_not_allowed" },
                    { status: 403 }
                );
            }
            const target = platformAdminCanonicalUrl(
                pathname,
                request.nextUrl.search
            );
            return NextResponse.redirect(target, 307);
        }
    }

    // NextRequest (v16) não expõe `.ip`; na Vercel o cliente vem em x-vercel-forwarded-for / xff.
    const candidates = collectClientIpCandidates(request.headers);
    const ip = candidates[0] ?? "";
    if (!isIpAllowed(ip, process.env.PLATFORM_ADMIN_IP_ALLOWLIST, candidates)) {
        if (pathname.startsWith("/api/")) {
            return NextResponse.json(
                { error: "IP not allowed", code: "ip_not_allowed" },
                { status: 403 }
            );
        }
        const url = request.nextUrl.clone();
        url.pathname = "/platform/forbidden";
        url.search = "";
        return NextResponse.redirect(url);
    }

    const publicPaths =
        pathname === "/platform/login" ||
        pathname.startsWith("/platform/login/") ||
        pathname === "/api/platform/auth/mfa/status";

    if (publicPaths || pathname.startsWith("/api/platform/")) {
        return NextResponse.next({ request: { headers: requestHeaders } });
    }

    const supabase = (options?.createClient ?? createServerClient)(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll: () => {},
            },
        }
    );

    const { data } = await supabase.auth.getUser();
    if (!data.user) {
        const url = request.nextUrl.clone();
        url.pathname = "/platform/login";
        url.searchParams.set("redirectTo", pathname);
        return NextResponse.redirect(url);
    }

    // Step-up: fator TOTP já verificado mas sessão ainda aal1 → força challenge
    const auth = supabase.auth as AuthClient["auth"];
    const aalRes = await auth.mfa?.getAuthenticatorAssuranceLevel?.();
    const aal = aalRes?.data;
    if (aal?.currentLevel !== "aal2" && aal?.nextLevel === "aal2") {
        const url = request.nextUrl.clone();
        url.pathname = "/platform/login/mfa";
        return NextResponse.redirect(url);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
}

function handleSuperadminBranch(request: NextRequest, pathname: string): NextResponse | null {
    if (!pathname.startsWith("/superadmin") && !pathname.startsWith("/api/superadmin/")) {
        return null;
    }
    if (pathname === "/superadmin/login" || pathname === "/api/superadmin/login") {
        const url = request.nextUrl.clone();
        url.pathname = pathname.replace("/superadmin", "/platform");
        return NextResponse.redirect(url);
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/superadmin/, "/platform");
    return NextResponse.redirect(url, 308);
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
        pathname.startsWith("/api/chatbot/reactivate") ||
        pathname.startsWith("/api/chatbot/detect-abandoned-carts") ||
        /** Cron sync catálogo marketplace (F4.1) — Bearer CRON_SECRET. */
        pathname.startsWith("/api/marketplace/sync-catalog") ||
        /**
         * Cron diário de cobrança (Vercel, sem cookie de sessão) — autentica via
         * `validateCronAuthorization` (Bearer CRON_SECRET) dentro da própria rota.
         * Faltava aqui: o proxy redirecionava pra /login antes do handler rodar.
         */
        pathname.startsWith("/api/billing/charge") ||
        pathname.startsWith("/api/platform/alerts/check") ||
        pathname.startsWith("/api/platform/audit/archive") ||
        pathname.startsWith("/api/print/") ||
        pathname.startsWith("/api/billing/webhook") ||
        pathname === "/api/billing/signup" ||
        /** Webhook Meta Page/Instagram Messaging: assinatura própria (X-Hub-Signature-256), sem cookie. */
        pathname.startsWith("/api/meta/messaging/incoming") ||
        /** Print agent (api_key nas rotas) + painel /api/agent/keys|settings (exige sessão na própria rota) */
        pathname.startsWith("/api/agent/") ||
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
        pathname.startsWith("/brand/") ||
        pathname.startsWith("/assets/") ||
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

    const dedicatedHostRes = handlePlatformDedicatedHost(request, pathname);
    if (dedicatedHostRes) return dedicatedHostRes;

    const platformRes = await handlePlatformBranch(request, pathname, options);
    if (platformRes) return platformRes;

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

    // Impersonação platform: somente leitura no tenant (bloqueia mutações)
    if (
        request.cookies.get(PLATFORM_IMPERSONATION_COOKIE)?.value &&
        isMutatingHttpMethod(request.method) &&
        isTenantMutationPath(pathname)
    ) {
        return NextResponse.json(
            {
                error: {
                    code: "impersonation_read_only",
                    message: "Modo suporte é somente leitura. Mutações bloqueadas.",
                },
            },
            { status: 403 }
        );
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
        }
    }

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
