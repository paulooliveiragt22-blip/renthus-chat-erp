"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const server_1 = require("next/server");
const proxy_1 = require("../proxy");
function createMockClient(user, aal = {
    currentLevel: "aal1",
    nextLevel: "aal1",
}) {
    const getUser = node_test_1.mock.fn(async () => ({ data: { user } }));
    const getAuthenticatorAssuranceLevel = node_test_1.mock.fn(async () => ({
        data: aal,
        error: null,
    }));
    const client = {
        auth: {
            getUser,
            mfa: { getAuthenticatorAssuranceLevel },
        },
    };
    const factory = node_test_1.mock.fn(() => client);
    return { factory, getUser, getAuthenticatorAssuranceLevel };
}
function createRequest(pathname, cookies, method = "GET", host) {
    const url = new URL(pathname, "https://example.com");
    const headers = {};
    if (cookies)
        headers.cookie = cookies;
    if (host)
        headers.host = host;
    return new server_1.NextRequest(url, { headers, method });
}
(0, node_test_1.describe)("proxy auth routing", () => {
    let factory;
    (0, node_test_1.beforeEach)(() => {
        factory = createMockClient(null).factory;
    });
    (0, node_test_1.it)("bypasses public auth routes without invoking Supabase", async () => {
        const response = await (0, proxy_1.proxy)(createRequest("/login"), undefined, {
            createClient: factory,
        });
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        node_assert_1.default.strictEqual(response.headers.get("location"), null);
    });
    (0, node_test_1.it)("exempts webhook and print endpoints", async () => {
        const response = await (0, proxy_1.proxy)(createRequest("/api/whatsapp/incoming"), undefined, { createClient: factory });
        const printResponse = await (0, proxy_1.proxy)(createRequest("/api/print/pull"), undefined, {
            createClient: factory,
        });
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        node_assert_1.default.strictEqual(response.headers.get("location"), null);
        node_assert_1.default.strictEqual(printResponse.headers.get("location"), null);
    });
    (0, node_test_1.it)("exempts scheduler routes that authenticate via CRON_SECRET", async () => {
        const paths = [
            "/api/chatbot/reactivate",
            "/api/chatbot/detect-abandoned-carts",
            "/api/billing/charge",
            "/api/billing/expire-trials",
            "/api/billing/mark-abandoned",
            "/api/platform/alerts/check",
            "/api/platform/audit/archive",
        ];
        for (const path of paths) {
            const response = await (0, proxy_1.proxy)(createRequest(path), undefined, {
                createClient: factory,
            });
            node_assert_1.default.strictEqual(response.headers.get("location"), null, path);
        }
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
    });
    (0, node_test_1.it)("exempts Meta Page/Instagram messaging webhook (assinatura própria, sem cookie)", async () => {
        const response = await (0, proxy_1.proxy)(createRequest("/api/meta/messaging/incoming"), undefined, { createClient: factory });
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        node_assert_1.default.strictEqual(response.headers.get("location"), null);
    });
    (0, node_test_1.it)("exempts /api/health (monitor externo de uptime, sem cookie)", async () => {
        const response = await (0, proxy_1.proxy)(createRequest("/api/health"), undefined, {
            createClient: factory,
        });
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        node_assert_1.default.strictEqual(response.headers.get("location"), null);
    });
    (0, node_test_1.it)("exempts /api/auth/sync-session e signout (tokens no body, sem cookie prévio)", async () => {
        for (const path of ["/api/auth/sync-session", "/api/auth/signout"]) {
            const response = await (0, proxy_1.proxy)(createRequest(path), undefined, {
                createClient: factory,
            });
            node_assert_1.default.strictEqual(response.headers.get("location"), null, path);
        }
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
    });
    (0, node_test_1.it)("exempts PWA assets without auth (manifest, SW, icons, offline)", async () => {
        const paths = [
            "/manifest.webmanifest",
            "/sw.js",
            "/workbox-c18c662b.js",
            "/icons/icon-192.png",
            "/offline",
            "/offline/",
        ];
        for (const path of paths) {
            const response = await (0, proxy_1.proxy)(createRequest(path), undefined, {
                createClient: factory,
            });
            node_assert_1.default.strictEqual(response.headers.get("location"), null, path);
        }
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
    });
    (0, node_test_1.it)("does not treat /api/offline/sync as public PWA asset", async () => {
        // Deve exigir auth/sessão no fluxo normal — não está na lista de exempt PWA
        const response = await (0, proxy_1.proxy)(createRequest("/api/offline/sync", undefined, "POST"), undefined, {
            createClient: factory,
        });
        // Sem cookie de sessão: redirect login ou 401/403 — nunca next() silencioso como /offline
        const loc = response.headers.get("location");
        const status = response.status;
        node_assert_1.default.ok(loc != null || status === 401 || status === 403 || status === 307 || status === 302, `expected auth gate, got status=${status} loc=${loc}`);
    });
    (0, node_test_1.it)("exempts public brand/assets without auth (login/signup logos)", async () => {
        const paths = [
            "/brand/renthus-mark-on-light.svg",
            "/brand/renthus-mark-on-dark.svg",
            "/brand/zampell-wordmark.png",
            "/assets/ICONE512X512.png",
        ];
        for (const path of paths) {
            const response = await (0, proxy_1.proxy)(createRequest(path), undefined, {
                createClient: factory,
            });
            node_assert_1.default.strictEqual(response.headers.get("location"), null, path);
        }
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
    });
    (0, node_test_1.it)("exempts print-agent machine routes (api_key / pairing)", async () => {
        const paths = [
            "/api/agent/activate",
            "/api/agent/auth",
            "/api/agent/heartbeat",
            "/api/agent/print-data",
            "/api/agent/reprint",
            "/api/agent/jobs/poll",
            "/api/agent/jobs/reserve",
            "/api/agent/jobs/complete",
            "/api/agent/jobs/fail",
        ];
        for (const path of paths) {
            const response = await (0, proxy_1.proxy)(createRequest(path), undefined, {
                createClient: factory,
            });
            node_assert_1.default.strictEqual(response.headers.get("location"), null, path);
        }
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
    });
    (0, node_test_1.it)("keeps /api/agent/keys and /api/agent/settings behind session", async () => {
        for (const path of ["/api/agent/keys", "/api/agent/settings"]) {
            const { factory: protectedFactory } = createMockClient(null);
            const response = await (0, proxy_1.proxy)(createRequest(path), undefined, {
                createClient: protectedFactory,
            });
            node_assert_1.default.strictEqual(response.status, 307, path);
            node_assert_1.default.strictEqual(response.headers.get("location"), "https://example.com/login", path);
        }
    });
    (0, node_test_1.it)("keeps session-backed chatbot routes behind auth", async () => {
        for (const path of ["/api/chatbot/config", "/api/chatbot/resolve"]) {
            const { factory: protectedFactory } = createMockClient(null);
            const response = await (0, proxy_1.proxy)(createRequest(path), undefined, {
                createClient: protectedFactory,
            });
            node_assert_1.default.strictEqual(response.status, 307, path);
            node_assert_1.default.strictEqual(response.headers.get("location"), "https://example.com/login");
        }
    });
    (0, node_test_1.it)("redirects unauthenticated users on protected routes", async () => {
        const { factory: protectedFactory } = createMockClient(null);
        const response = await (0, proxy_1.proxy)(createRequest("/dashboard"), undefined, {
            createClient: protectedFactory,
        });
        node_assert_1.default.strictEqual(protectedFactory.mock.calls.length, 1);
        node_assert_1.default.strictEqual(response.status, 307);
        node_assert_1.default.strictEqual(response.headers.get("location"), "https://example.com/login");
    });
    (0, node_test_1.it)("redirects superadmin to platform", async () => {
        const response = await (0, proxy_1.proxy)(createRequest("/superadmin/empresas"), undefined, {
            createClient: factory,
        });
        node_assert_1.default.strictEqual(response.status, 308);
        node_assert_1.default.strictEqual(response.headers.get("location"), "https://example.com/platform/empresas");
    });
    (0, node_test_1.it)("redirects platform UI to PLATFORM_ADMIN_HOST when Host differs", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        const prevVercel = process.env.VERCEL_ENV;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        delete process.env.VERCEL_ENV;
        delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        try {
            const response = await (0, proxy_1.proxy)(createRequest("/platform/empresas"), undefined, { createClient: factory });
            node_assert_1.default.strictEqual(response.status, 307);
            node_assert_1.default.strictEqual(response.headers.get("location"), "https://platform.renthus.com.br/platform/empresas");
        }
        finally {
            if (prevHost === undefined)
                delete process.env.PLATFORM_ADMIN_HOST;
            else
                process.env.PLATFORM_ADMIN_HOST = prevHost;
            if (prevVercel === undefined)
                delete process.env.VERCEL_ENV;
            else
                process.env.VERCEL_ENV = prevVercel;
            if (prevList === undefined)
                delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else
                process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });
    (0, node_test_1.it)("allows platform cron on wrong host (CRON_SECRET auth)", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await (0, proxy_1.proxy)(createRequest("/api/platform/alerts/check"), undefined, { createClient: factory });
            node_assert_1.default.strictEqual(response.status, 200);
            node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        }
        finally {
            if (prevHost === undefined)
                delete process.env.PLATFORM_ADMIN_HOST;
            else
                process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });
    (0, node_test_1.it)("blocks platform API with host_not_allowed on wrong host", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await (0, proxy_1.proxy)(createRequest("/api/platform/companies"), undefined, { createClient: factory });
            node_assert_1.default.strictEqual(response.status, 403);
            const body = await response.json();
            node_assert_1.default.strictEqual(body.code, "host_not_allowed");
        }
        finally {
            if (prevHost === undefined)
                delete process.env.PLATFORM_ADMIN_HOST;
            else
                process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });
    (0, node_test_1.it)("redirects tenant UI on dedicated platform host to /platform", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        try {
            for (const path of ["/", "/fila", "/dashboard", "/pedidos"]) {
                const response = await (0, proxy_1.proxy)(createRequest(path, undefined, "GET", "platform.renthus.com.br"), undefined, { createClient: factory });
                node_assert_1.default.strictEqual(response.status, 307, path);
                node_assert_1.default.strictEqual(response.headers.get("location"), "https://example.com/platform", path);
            }
            node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        }
        finally {
            if (prevHost === undefined)
                delete process.env.PLATFORM_ADMIN_HOST;
            else
                process.env.PLATFORM_ADMIN_HOST = prevHost;
            if (prevList === undefined)
                delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else
                process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });
    (0, node_test_1.it)("redirects tenant login on dedicated platform host to /platform/login", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await (0, proxy_1.proxy)(createRequest("/login?redirectTo=%2Ffila", undefined, "GET", "platform.renthus.com.br"), undefined, { createClient: factory });
            node_assert_1.default.strictEqual(response.status, 307);
            node_assert_1.default.strictEqual(response.headers.get("location"), "https://example.com/platform/login?redirectTo=%2Ffila");
            node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        }
        finally {
            if (prevHost === undefined)
                delete process.env.PLATFORM_ADMIN_HOST;
            else
                process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });
    (0, node_test_1.it)("blocks tenant API on dedicated platform host", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await (0, proxy_1.proxy)(createRequest("/api/admin/orders", undefined, "GET", "platform.renthus.com.br"), undefined, { createClient: factory });
            node_assert_1.default.strictEqual(response.status, 403);
            const body = await response.json();
            node_assert_1.default.strictEqual(body.code, "host_not_allowed");
            node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        }
        finally {
            if (prevHost === undefined)
                delete process.env.PLATFORM_ADMIN_HOST;
            else
                process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });
    (0, node_test_1.it)("allows impersonate API on tenant host (AdminShell banner)", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await (0, proxy_1.proxy)(createRequest("/api/platform/impersonate", undefined, "GET", "app.renthus.com.br"), undefined, { createClient: factory });
            node_assert_1.default.notStrictEqual(response.status, 403);
            const body = (await response.json().catch(() => ({})));
            node_assert_1.default.notStrictEqual(body.code, "host_not_allowed");
        }
        finally {
            if (prevHost === undefined)
                delete process.env.PLATFORM_ADMIN_HOST;
            else
                process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });
    (0, node_test_1.it)("allows platform login without session", async () => {
        const response = await (0, proxy_1.proxy)(createRequest("/platform/login"), undefined, {
            createClient: factory,
        });
        node_assert_1.default.strictEqual(factory.mock.calls.length, 0);
        node_assert_1.default.strictEqual(response.status, 200);
    });
    (0, node_test_1.it)("redirects platform pages to MFA when session is aal1 with verified factor", async () => {
        const prevVercel = process.env.VERCEL_ENV;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        delete process.env.VERCEL_ENV;
        delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        try {
            const { factory: authed } = createMockClient({ id: "user-1" }, { currentLevel: "aal1", nextLevel: "aal2" });
            const response = await (0, proxy_1.proxy)(createRequest("/platform/empresas"), undefined, {
                createClient: authed,
            });
            node_assert_1.default.strictEqual(response.status, 307);
            node_assert_1.default.ok(response.headers.get("location")?.includes("/platform/login/mfa"), response.headers.get("location") ?? "");
        }
        finally {
            if (prevVercel === undefined)
                delete process.env.VERCEL_ENV;
            else
                process.env.VERCEL_ENV = prevVercel;
            if (prevList === undefined)
                delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else
                process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });
    (0, node_test_1.it)("redirects platform pages to forbidden when IP allowlist blocks in prod", async () => {
        const prevVercel = process.env.VERCEL_ENV;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        process.env.VERCEL_ENV = "production";
        process.env.PLATFORM_ADMIN_IP_ALLOWLIST = "203.0.113.10";
        try {
            const response = await (0, proxy_1.proxy)(createRequest("/platform/login"), undefined, {
                createClient: factory,
            });
            node_assert_1.default.strictEqual(response.status, 307);
            node_assert_1.default.ok(response.headers.get("location")?.includes("/platform/forbidden"), response.headers.get("location") ?? "");
        }
        finally {
            if (prevVercel === undefined)
                delete process.env.VERCEL_ENV;
            else
                process.env.VERCEL_ENV = prevVercel;
            if (prevList === undefined)
                delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else
                process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });
    (0, node_test_1.it)("blocks tenant mutations while platform impersonation cookie is set", async () => {
        const { factory: protectedFactory } = createMockClient({ id: "user-123" });
        const response = await (0, proxy_1.proxy)(createRequest("/api/admin/orders", "platform_impersonation=sess-1", "POST"), undefined, { createClient: protectedFactory });
        node_assert_1.default.strictEqual(response.status, 403);
        const body = await response.json();
        node_assert_1.default.strictEqual(body.error.code, "impersonation_read_only");
    });
});
(0, node_test_1.describe)("proxy billing paywall (P0.10)", () => {
    const originalFetch = globalThis.fetch;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    function mockSupabaseRest(subStatus, company = {}, subExtra = {}) {
        globalThis.fetch = (async (input) => {
            const url = String(input);
            if (url.includes("pagarme_subscriptions")) {
                return new Response(JSON.stringify([
                    {
                        status: subStatus,
                        trial_ends_at: null,
                        last_paid_at: null,
                        plan: "essencial",
                        ...subExtra,
                    },
                ]), { status: 200 });
            }
            if (url.includes("companies")) {
                return new Response(JSON.stringify([
                    {
                        senha_definida: true,
                        onboarding_completed_at: null,
                        onboarding_token: null,
                        is_active: false,
                        ...company,
                    },
                ]), { status: 200 });
            }
            return new Response("not found", { status: 404 });
        });
    }
    (0, node_test_1.afterEach)(() => {
        globalThis.fetch = originalFetch;
        if (prevSupabaseUrl === undefined)
            delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else
            process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
        if (prevServiceKey === undefined)
            delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else
            process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
    });
    (0, node_test_1.it)("redirects pending_payment from /pdv to /plano/pagar", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        mockSupabaseRest("pending_payment");
        const { factory } = createMockClient({ id: "user-1" });
        const response = await (0, proxy_1.proxy)(createRequest("/pdv", "renthus_company_id=comp-1"), undefined, { createClient: factory });
        node_assert_1.default.strictEqual(response.status, 307);
        const loc = response.headers.get("location") ?? "";
        node_assert_1.default.ok(loc.includes("/plano/pagar"), loc);
    });
    (0, node_test_1.it)("allows /configuracoes?tab=plano during paywall", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        mockSupabaseRest("blocked");
        const { factory } = createMockClient({ id: "user-1" });
        const response = await (0, proxy_1.proxy)(createRequest("/configuracoes?tab=plano", "renthus_company_id=comp-1"), undefined, { createClient: factory });
        node_assert_1.default.notStrictEqual(response.status, 307);
    });
    (0, node_test_1.it)("fail-closed on fetch error (redirect paywall)", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        globalThis.fetch = (async () => {
            throw new Error("network down");
        });
        const { factory } = createMockClient({ id: "user-1" });
        const response = await (0, proxy_1.proxy)(createRequest("/dashboard", "renthus_company_id=comp-1"), undefined, { createClient: factory });
        node_assert_1.default.strictEqual(response.status, 307);
        const loc = response.headers.get("location") ?? "";
        node_assert_1.default.ok(loc.includes("/plano/pagar"), loc);
    });
    (0, node_test_1.it)("does not skip paywall via renthus_access_ok cookie", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        mockSupabaseRest("pending_payment");
        const { factory } = createMockClient({ id: "user-1" });
        const response = await (0, proxy_1.proxy)(createRequest("/pdv", `renthus_company_id=comp-1; renthus_access_ok=comp-1:${Date.now()}`), undefined, { createClient: factory });
        node_assert_1.default.strictEqual(response.status, 307);
        node_assert_1.default.ok((response.headers.get("location") ?? "").includes("/plano/pagar"));
    });
    (0, node_test_1.it)("redirects trial expired (trial_ends_at no passado) to /plano/pagar", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        mockSupabaseRest("trial", { is_active: true, onboarding_completed_at: "2026-01-01" }, {
            trial_ends_at: "2020-01-01T00:00:00.000Z",
        });
        const { factory } = createMockClient({ id: "user-1" });
        const response = await (0, proxy_1.proxy)(createRequest("/pdv", "renthus_company_id=comp-1"), undefined, { createClient: factory });
        node_assert_1.default.strictEqual(response.status, 307);
        node_assert_1.default.ok((response.headers.get("location") ?? "").includes("/plano/pagar"));
    });
});
