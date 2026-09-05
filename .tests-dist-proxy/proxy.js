"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.proxy = proxy;
// proxy.ts — convenção Next.js 16+ (substitui middleware.ts na raiz do projeto)
const server_1 = require("next/server");
const ssr_1 = require("@supabase/ssr");
const crypto_1 = require("crypto");
const checkPlatformIpAllowlist_1 = require("@/lib/platform/checkPlatformIpAllowlist");
const resolvePlatformRequestHost_1 = require("@/lib/platform/resolvePlatformRequestHost");
const impersonation_1 = require("@/lib/platform/impersonation");
const menuHostRewrite_1 = require("@/lib/public-menu/menuHostRewrite");
const tenantAccess_1 = require("@/lib/billing/tenantAccess");
/** Rotas permitidas enquanto billing paywall está ativo (P0.10). */
function isBillingPaywallAllowedPath(pathname, searchParams) {
    if (pathname === "/logout" || pathname.startsWith("/logout/"))
        return true;
    if (pathname === "/plano" || pathname.startsWith("/plano/"))
        return true;
    if (pathname.startsWith("/oauth/"))
        return true;
    if (pathname === "/configuracoes" && searchParams.get("tab") === "plano")
        return true;
    if (pathname.startsWith("/configuracoes/") && searchParams.get("tab") === "plano")
        return true;
    return false;
}
function billingPaywallRedirect(request) {
    const payUrl = request.nextUrl.clone();
    payUrl.pathname = "/plano/pagar";
    payUrl.search = "";
    return server_1.NextResponse.redirect(payUrl);
}
/** Redirecionamentos de cobrança / onboarding (extraído para reduzir complexidade cognitiva do proxy). */
async function checkCompanyAccess(request, pathname, companyId, supabaseUrl, serviceKey) {
    try {
        const [subRes, compRes] = await Promise.all([
            fetch(`${supabaseUrl}/rest/v1/pagarme_subscriptions` +
                `?company_id=eq.${encodeURIComponent(companyId)}` +
                `&select=status,trial_ends_at,last_paid_at,plan&limit=1`, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }),
            fetch(`${supabaseUrl}/rest/v1/companies` +
                `?id=eq.${encodeURIComponent(companyId)}` +
                `&select=senha_definida,onboarding_completed_at,onboarding_token,is_active&limit=1`, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }),
        ]);
        const [sub] = subRes.ok ? (await subRes.json()) : [];
        const [comp] = compRes.ok ? (await compRes.json()) : [];
        const tenant = (0, tenantAccess_1.resolveTenantAccess)(sub
            ? {
                status: sub.status,
                trial_ends_at: sub.trial_ends_at ?? null,
                last_paid_at: sub.last_paid_at ?? null,
                plan: sub.plan ?? null,
            }
            : null);
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
                return { type: "redirect", response: server_1.NextResponse.redirect(onboardUrl) };
            }
        }
        return { type: "allow" };
    }
    catch (err) {
        console.error("[proxy] checkCompanyAccess:", err);
        return { type: "redirect", response: billingPaywallRedirect(request) };
    }
}
/** Rotas tenant / APIs internas não devem ser servidas no host dedicado platform.* */
function handlePlatformDedicatedHost(request, pathname) {
    if (!(0, resolvePlatformRequestHost_1.isPlatformDedicatedHostRequest)(request.headers, request.nextUrl.hostname)) {
        return null;
    }
    if (pathname.startsWith("/platform") ||
        pathname.startsWith("/api/platform/")) {
        return null;
    }
    if (pathname.startsWith("/_next") ||
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
        isTechnicalApiPublic(pathname)) {
        return server_1.NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
        return server_1.NextResponse.json({ error: "Host not allowed", code: "host_not_allowed" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    if (pathname === "/login" || pathname.startsWith("/login/")) {
        url.pathname = "/platform/login";
    }
    else {
        url.pathname = "/platform";
        url.search = "";
    }
    return server_1.NextResponse.redirect(url, 307);
}
async function handlePlatformBranch(request, pathname, options) {
    if (!pathname.startsWith("/platform") && !pathname.startsWith("/api/platform/")) {
        return null;
    }
    const requestHeaders = new Headers(request.headers);
    if (!requestHeaders.get("x-request-id")) {
        requestHeaders.set("x-request-id", (0, crypto_1.randomUUID)());
    }
    // Página de diagnóstico do allowlist — sempre acessível (mesmo Host errado ajuda ops)
    if (pathname === "/platform/forbidden") {
        return server_1.NextResponse.next({ request: { headers: requestHeaders } });
    }
    // Crons + impersonation status no host tenant (AdminShell banner em app.*)
    if (pathname === "/api/platform/alerts/check" ||
        pathname === "/api/platform/audit/archive" ||
        pathname === "/api/platform/impersonate") {
        return server_1.NextResponse.next({ request: { headers: requestHeaders } });
    }
    // Host dedicado: UI redireciona para platform.*; API → 403
    const adminHost = (0, resolvePlatformRequestHost_1.getPlatformAdminHost)();
    if (adminHost) {
        const reqHost = (0, resolvePlatformRequestHost_1.resolveRequestHostname)(request.headers) ||
            request.nextUrl.hostname.toLowerCase();
        if (reqHost && reqHost !== adminHost) {
            if (pathname.startsWith("/api/")) {
                return server_1.NextResponse.json({ error: "Host not allowed", code: "host_not_allowed" }, { status: 403 });
            }
            const target = (0, resolvePlatformRequestHost_1.platformAdminCanonicalUrl)(pathname, request.nextUrl.search);
            return server_1.NextResponse.redirect(target, 307);
        }
    }
    // NextRequest (v16) não expõe `.ip`; na Vercel o cliente vem em x-vercel-forwarded-for / xff.
    const candidates = (0, checkPlatformIpAllowlist_1.collectClientIpCandidates)(request.headers);
    const ip = candidates[0] ?? "";
    if (!(0, checkPlatformIpAllowlist_1.isIpAllowed)(ip, process.env.PLATFORM_ADMIN_IP_ALLOWLIST, candidates)) {
        if (pathname.startsWith("/api/")) {
            return server_1.NextResponse.json({ error: "IP not allowed", code: "ip_not_allowed" }, { status: 403 });
        }
        const url = request.nextUrl.clone();
        url.pathname = "/platform/forbidden";
        url.search = "";
        return server_1.NextResponse.redirect(url);
    }
    const publicPaths = pathname === "/platform/login" ||
        pathname.startsWith("/platform/login/") ||
        pathname === "/api/platform/auth/mfa/status";
    if (publicPaths || pathname.startsWith("/api/platform/")) {
        return server_1.NextResponse.next({ request: { headers: requestHeaders } });
    }
    const supabase = (options?.createClient ?? ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: () => { },
        },
    });
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
        const url = request.nextUrl.clone();
        url.pathname = "/platform/login";
        url.searchParams.set("redirectTo", pathname);
        return server_1.NextResponse.redirect(url);
    }
    // Step-up: fator TOTP já verificado mas sessão ainda aal1 → força challenge
    const auth = supabase.auth;
    const aalRes = await auth.mfa?.getAuthenticatorAssuranceLevel?.();
    const aal = aalRes?.data;
    if (aal?.currentLevel !== "aal2" && aal?.nextLevel === "aal2") {
        const url = request.nextUrl.clone();
        url.pathname = "/platform/login/mfa";
        return server_1.NextResponse.redirect(url);
    }
    return server_1.NextResponse.next({ request: { headers: requestHeaders } });
}
function handleSuperadminBranch(request, pathname) {
    if (!pathname.startsWith("/superadmin") && !pathname.startsWith("/api/superadmin/")) {
        return null;
    }
    if (pathname === "/superadmin/login" || pathname === "/api/superadmin/login") {
        const url = request.nextUrl.clone();
        url.pathname = pathname.replace("/superadmin", "/platform");
        return server_1.NextResponse.redirect(url);
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/superadmin/, "/platform");
    return server_1.NextResponse.redirect(url, 308);
}
/** Rotas da máquina (api_key / código de pareamento). Painel keys/settings fica de fora. */
function isPrintAgentMachineApi(pathname) {
    return (pathname === "/api/agent/activate" ||
        pathname.startsWith("/api/agent/activate/") ||
        pathname === "/api/agent/auth" ||
        pathname === "/api/agent/heartbeat" ||
        pathname === "/api/agent/print-data" ||
        pathname === "/api/agent/reprint" ||
        pathname.startsWith("/api/agent/jobs/"));
}
function isTechnicalApiPublic(pathname) {
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
        pathname.startsWith("/api/billing/expire-trials") ||
        pathname.startsWith("/api/billing/mark-abandoned") ||
        pathname.startsWith("/api/platform/alerts/check") ||
        pathname.startsWith("/api/platform/audit/archive") ||
        pathname.startsWith("/api/print/") ||
        pathname.startsWith("/api/billing/webhook") ||
        pathname === "/api/billing/signup" ||
        /** Webhook Meta Page/Instagram Messaging: assinatura própria (X-Hub-Signature-256), sem cookie. */
        pathname.startsWith("/api/meta/messaging/incoming") ||
        /** Print agent com api_key / pairing. keys|settings exigem cookie (S7). */
        isPrintAgentMachineApi(pathname) ||
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
        pathname === "/api/health");
}
function isPublicAppRoute(pathname) {
    return (pathname.startsWith("/login") ||
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
        pathname.startsWith("/offline/"));
}
async function proxy(request, _event, options) {
    const pathname = request.nextUrl.pathname;
    // F4.3: subdomínio / domínio próprio → /c/{slug}
    const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const hostRewrite = await (0, menuHostRewrite_1.resolveMenuHostRewrite)({
        host: hostHeader,
        pathname,
        lookupCustomDomainSlug: supabaseUrl && serviceKey
            ? (host) => (0, menuHostRewrite_1.lookupMenuSlugByHostViaRest)({
                host,
                supabaseUrl,
                serviceKey,
            })
            : undefined,
    });
    if (hostRewrite.rewrite) {
        const url = request.nextUrl.clone();
        url.pathname = hostRewrite.pathname;
        return server_1.NextResponse.rewrite(url);
    }
    const dedicatedHostRes = handlePlatformDedicatedHost(request, pathname);
    if (dedicatedHostRes)
        return dedicatedHostRes;
    const platformRes = await handlePlatformBranch(request, pathname, options);
    if (platformRes)
        return platformRes;
    const superRes = handleSuperadminBranch(request, pathname);
    if (superRes)
        return superRes;
    if (isTechnicalApiPublic(pathname))
        return server_1.NextResponse.next();
    if (isPublicAppRoute(pathname))
        return server_1.NextResponse.next();
    const response = server_1.NextResponse.next();
    // Cria client server-side
    const supabase = (options?.createClient ?? ssr_1.createServerClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: (cookiesToSet) => {
                cookiesToSet.forEach(({ name, value, options: o }) => {
                    response.cookies.set(name, value, o);
                });
            },
        },
    });
    const { data } = await supabase.auth.getUser();
    const isLoggedIn = !!data.user;
    if (!isLoggedIn) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        return server_1.NextResponse.redirect(url);
    }
    // Impersonação platform: somente leitura no tenant (bloqueia mutações)
    if (request.cookies.get(impersonation_1.PLATFORM_IMPERSONATION_COOKIE)?.value &&
        (0, impersonation_1.isMutatingHttpMethod)(request.method) &&
        (0, impersonation_1.isTenantMutationPath)(pathname)) {
        return server_1.NextResponse.json({
            error: {
                code: "impersonation_read_only",
                message: "Modo suporte é somente leitura. Mutações bloqueadas.",
            },
        }, { status: 403 });
    }
    // ── Checks para usuários logados (somente rotas de painel, não API) ──
    if (!pathname.startsWith("/api/")) {
        const companyId = request.cookies.get("renthus_company_id")?.value;
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (companyId) {
            const guard = await checkCompanyAccess(request, pathname, companyId, supabaseUrl, serviceKey);
            if (guard.type === "redirect")
                return guard.response;
        }
    }
    return response;
}
exports.config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
