import assert from "node:assert";
import { beforeEach, afterEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { proxy, type SupabaseClientFactory } from "../proxy";

type MockedClientFactory = SupabaseClientFactory & {
    mock: ReturnType<typeof mock.fn>["mock"];
};

function createMockClient(
    user: unknown,
    aal: { currentLevel: string | null; nextLevel: string | null } = {
        currentLevel: "aal1",
        nextLevel: "aal1",
    }
) {
    const getUser = mock.fn(async () => ({ data: { user } }));
    const getAuthenticatorAssuranceLevel = mock.fn(async () => ({
        data: aal,
        error: null,
    }));
    const client = {
        auth: {
            getUser,
            mfa: { getAuthenticatorAssuranceLevel },
        },
    };
    const factory = mock.fn(() => client) as unknown as MockedClientFactory;
    return { factory, getUser, getAuthenticatorAssuranceLevel } as const;
}

function createRequest(
    pathname: string,
    cookies?: string,
    method = "GET",
    host?: string
) {
    const url = new URL(pathname, "https://example.com");
    const headers: Record<string, string> = {};
    if (cookies) headers.cookie = cookies;
    if (host) headers.host = host;
    return new NextRequest(url, { headers, method });
}

describe("proxy auth routing", () => {
    let factory: MockedClientFactory;

    beforeEach(() => {
        factory = createMockClient(null).factory;
    });

    it("bypasses public auth routes without invoking Supabase", async () => {
        const response = await proxy(createRequest("/login"), undefined, {
            createClient: factory,
        });

        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.headers.get("location"), null);
    });

    it("exempts webhook and print endpoints", async () => {
        const response = await proxy(
            createRequest("/api/whatsapp/incoming"),
            undefined,
            { createClient: factory }
        );
        const printResponse = await proxy(createRequest("/api/print/pull"), undefined, {
            createClient: factory,
        });

        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.headers.get("location"), null);
        assert.strictEqual(printResponse.headers.get("location"), null);
    });

    it("exempts scheduler routes that authenticate via CRON_SECRET", async () => {
        const paths = [
            "/api/chatbot/process-queue",
            "/api/chatbot/reactivate",
            "/api/chatbot/detect-abandoned-carts",
            "/api/chatbot/outbound-worker",
            "/api/billing/charge",
            "/api/platform/alerts/check",
            "/api/platform/audit/archive",
        ];

        for (const path of paths) {
            const response = await proxy(createRequest(path), undefined, {
                createClient: factory,
            });
            assert.strictEqual(response.headers.get("location"), null, path);
        }

        assert.strictEqual(factory.mock.calls.length, 0);
    });

    it("exempts Meta Page/Instagram messaging webhook (assinatura própria, sem cookie)", async () => {
        const response = await proxy(
            createRequest("/api/meta/messaging/incoming"),
            undefined,
            { createClient: factory }
        );

        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.headers.get("location"), null);
    });

    it("exempts /api/health (monitor externo de uptime, sem cookie)", async () => {
        const response = await proxy(createRequest("/api/health"), undefined, {
            createClient: factory,
        });

        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.headers.get("location"), null);
    });

    it("exempts /api/auth/sync-session e signout (tokens no body, sem cookie prévio)", async () => {
        for (const path of ["/api/auth/sync-session", "/api/auth/signout"]) {
            const response = await proxy(createRequest(path), undefined, {
                createClient: factory,
            });
            assert.strictEqual(response.headers.get("location"), null, path);
        }
        assert.strictEqual(factory.mock.calls.length, 0);
    });

    it("exempts PWA assets without auth (manifest, SW, icons, offline)", async () => {
        const paths = [
            "/manifest.webmanifest",
            "/sw.js",
            "/workbox-c18c662b.js",
            "/icons/icon-192.png",
            "/offline",
        ];
        for (const path of paths) {
            const response = await proxy(createRequest(path), undefined, {
                createClient: factory,
            });
            assert.strictEqual(response.headers.get("location"), null, path);
        }
        assert.strictEqual(factory.mock.calls.length, 0);
    });

    it("keeps session-backed chatbot routes behind auth", async () => {
        for (const path of ["/api/chatbot/config", "/api/chatbot/resolve"]) {
            const { factory: protectedFactory } = createMockClient(null);
            const response = await proxy(createRequest(path), undefined, {
                createClient: protectedFactory,
            });
            assert.strictEqual(response.status, 307, path);
            assert.strictEqual(response.headers.get("location"), "https://example.com/login");
        }
    });

    it("redirects unauthenticated users on protected routes", async () => {
        const { factory: protectedFactory } = createMockClient(null);
        const response = await proxy(createRequest("/dashboard"), undefined, {
            createClient: protectedFactory,
        });

        assert.strictEqual(protectedFactory.mock.calls.length, 1);
        assert.strictEqual(response.status, 307);
        assert.strictEqual(response.headers.get("location"), "https://example.com/login");
    });

    it("redirects superadmin to platform", async () => {
        const response = await proxy(createRequest("/superadmin/empresas"), undefined, {
            createClient: factory,
        });
        assert.strictEqual(response.status, 308);
        assert.strictEqual(response.headers.get("location"), "https://example.com/platform/empresas");
    });

    it("redirects platform UI to PLATFORM_ADMIN_HOST when Host differs", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        const prevVercel = process.env.VERCEL_ENV;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        delete process.env.VERCEL_ENV;
        delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        try {
            const response = await proxy(
                createRequest("/platform/empresas"),
                undefined,
                { createClient: factory }
            );
            assert.strictEqual(response.status, 307);
            assert.strictEqual(
                response.headers.get("location"),
                "https://platform.renthus.com.br/platform/empresas"
            );
        } finally {
            if (prevHost === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prevHost;
            if (prevVercel === undefined) delete process.env.VERCEL_ENV;
            else process.env.VERCEL_ENV = prevVercel;
            if (prevList === undefined) delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });

    it("allows platform cron on wrong host (CRON_SECRET auth)", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await proxy(
                createRequest("/api/platform/alerts/check"),
                undefined,
                { createClient: factory }
            );
            assert.strictEqual(response.status, 200);
            assert.strictEqual(factory.mock.calls.length, 0);
        } finally {
            if (prevHost === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });

    it("blocks platform API with host_not_allowed on wrong host", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await proxy(
                createRequest("/api/platform/companies"),
                undefined,
                { createClient: factory }
            );
            assert.strictEqual(response.status, 403);
            const body = await response.json();
            assert.strictEqual(body.code, "host_not_allowed");
        } finally {
            if (prevHost === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });

    it("redirects tenant UI on dedicated platform host to /platform", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        try {
            for (const path of ["/", "/fila", "/dashboard", "/pedidos"]) {
                const response = await proxy(
                    createRequest(path, undefined, "GET", "platform.renthus.com.br"),
                    undefined,
                    { createClient: factory }
                );
                assert.strictEqual(response.status, 307, path);
                assert.strictEqual(
                    response.headers.get("location"),
                    "https://example.com/platform",
                    path
                );
            }
            assert.strictEqual(factory.mock.calls.length, 0);
        } finally {
            if (prevHost === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prevHost;
            if (prevList === undefined) delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });

    it("redirects tenant login on dedicated platform host to /platform/login", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await proxy(
                createRequest(
                    "/login?redirectTo=%2Ffila",
                    undefined,
                    "GET",
                    "platform.renthus.com.br"
                ),
                undefined,
                { createClient: factory }
            );
            assert.strictEqual(response.status, 307);
            assert.strictEqual(
                response.headers.get("location"),
                "https://example.com/platform/login?redirectTo=%2Ffila"
            );
            assert.strictEqual(factory.mock.calls.length, 0);
        } finally {
            if (prevHost === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });

    it("blocks tenant API on dedicated platform host", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await proxy(
                createRequest(
                    "/api/admin/orders",
                    undefined,
                    "GET",
                    "platform.renthus.com.br"
                ),
                undefined,
                { createClient: factory }
            );
            assert.strictEqual(response.status, 403);
            const body = await response.json();
            assert.strictEqual(body.code, "host_not_allowed");
            assert.strictEqual(factory.mock.calls.length, 0);
        } finally {
            if (prevHost === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });

    it("allows impersonate API on tenant host (AdminShell banner)", async () => {
        const prevHost = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            const response = await proxy(
                createRequest(
                    "/api/platform/impersonate",
                    undefined,
                    "GET",
                    "app.renthus.com.br"
                ),
                undefined,
                { createClient: factory }
            );
            assert.notStrictEqual(response.status, 403);
            const body = (await response.json().catch(() => ({}))) as {
                code?: string;
            };
            assert.notStrictEqual(body.code, "host_not_allowed");
        } finally {
            if (prevHost === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prevHost;
        }
    });

    it("allows platform login without session", async () => {
        const response = await proxy(createRequest("/platform/login"), undefined, {
            createClient: factory,
        });
        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.status, 200);
    });

    it("redirects platform pages to MFA when session is aal1 with verified factor", async () => {
        const prevVercel = process.env.VERCEL_ENV;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        delete process.env.VERCEL_ENV;
        delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        try {
            const { factory: authed } = createMockClient(
                { id: "user-1" },
                { currentLevel: "aal1", nextLevel: "aal2" }
            );
            const response = await proxy(createRequest("/platform/empresas"), undefined, {
                createClient: authed,
            });
            assert.strictEqual(response.status, 307);
            assert.ok(
                response.headers.get("location")?.includes("/platform/login/mfa"),
                response.headers.get("location") ?? ""
            );
        } finally {
            if (prevVercel === undefined) delete process.env.VERCEL_ENV;
            else process.env.VERCEL_ENV = prevVercel;
            if (prevList === undefined) delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });

    it("redirects platform pages to forbidden when IP allowlist blocks in prod", async () => {
        const prevVercel = process.env.VERCEL_ENV;
        const prevList = process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
        process.env.VERCEL_ENV = "production";
        process.env.PLATFORM_ADMIN_IP_ALLOWLIST = "203.0.113.10";
        try {
            const response = await proxy(createRequest("/platform/login"), undefined, {
                createClient: factory,
            });
            assert.strictEqual(response.status, 307);
            assert.ok(
                response.headers.get("location")?.includes("/platform/forbidden"),
                response.headers.get("location") ?? ""
            );
        } finally {
            if (prevVercel === undefined) delete process.env.VERCEL_ENV;
            else process.env.VERCEL_ENV = prevVercel;
            if (prevList === undefined) delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
            else process.env.PLATFORM_ADMIN_IP_ALLOWLIST = prevList;
        }
    });

    it("blocks tenant mutations while platform impersonation cookie is set", async () => {
        const { factory: protectedFactory } = createMockClient({ id: "user-123" });
        const response = await proxy(
            createRequest("/api/admin/orders", "platform_impersonation=sess-1", "POST"),
            undefined,
            { createClient: protectedFactory }
        );
        assert.strictEqual(response.status, 403);
        const body = await response.json();
        assert.strictEqual(body.error.code, "impersonation_read_only");
    });
});

describe("proxy billing paywall (P0.10)", () => {
    const originalFetch = globalThis.fetch;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    function mockSupabaseRest(subStatus: string, company: Record<string, unknown> = {}) {
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("pagarme_subscriptions")) {
                return new Response(JSON.stringify([{ status: subStatus }]), { status: 200 });
            }
            if (url.includes("companies")) {
                return new Response(
                    JSON.stringify([
                        {
                            senha_definida: true,
                            onboarding_completed_at: null,
                            onboarding_token: null,
                            is_active: false,
                            ...company,
                        },
                    ]),
                    { status: 200 }
                );
            }
            return new Response("not found", { status: 404 });
        }) as typeof fetch;
    }

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (prevSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
        if (prevServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
    });

    it("redirects pending_payment from /pdv to /plano/pagar", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        mockSupabaseRest("pending_payment");

        const { factory } = createMockClient({ id: "user-1" });
        const response = await proxy(
            createRequest("/pdv", "renthus_company_id=comp-1"),
            undefined,
            { createClient: factory }
        );

        assert.strictEqual(response.status, 307);
        const loc = response.headers.get("location") ?? "";
        assert.ok(loc.includes("/plano/pagar"), loc);
    });

    it("allows /configuracoes?tab=plano during paywall", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        mockSupabaseRest("blocked");

        const { factory } = createMockClient({ id: "user-1" });
        const response = await proxy(
            createRequest("/configuracoes?tab=plano", "renthus_company_id=comp-1"),
            undefined,
            { createClient: factory }
        );

        assert.notStrictEqual(response.status, 307);
    });

    it("fail-closed on fetch error (redirect paywall)", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        globalThis.fetch = (async () => {
            throw new Error("network down");
        }) as typeof fetch;

        const { factory } = createMockClient({ id: "user-1" });
        const response = await proxy(
            createRequest("/dashboard", "renthus_company_id=comp-1"),
            undefined,
            { createClient: factory }
        );

        assert.strictEqual(response.status, 307);
        const loc = response.headers.get("location") ?? "";
        assert.ok(loc.includes("/plano/pagar"), loc);
    });

    it("does not skip paywall via renthus_access_ok cookie", async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
        mockSupabaseRest("pending_payment");

        const { factory } = createMockClient({ id: "user-1" });
        const response = await proxy(
            createRequest(
                "/pdv",
                `renthus_company_id=comp-1; renthus_access_ok=comp-1:${Date.now()}`
            ),
            undefined,
            { createClient: factory }
        );

        assert.strictEqual(response.status, 307);
        assert.ok((response.headers.get("location") ?? "").includes("/plano/pagar"));
    });
});
