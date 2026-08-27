import assert from "node:assert";
import { beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { proxy, type SupabaseClientFactory } from "../proxy";

type MockedClientFactory = SupabaseClientFactory & {
    mock: ReturnType<typeof mock.fn>["mock"];
};

function createMockClient(user: unknown) {
    const getUser = mock.fn(async () => ({ data: { user } }));
    const client = { auth: { getUser } };
    const factory = mock.fn(() => client) as unknown as MockedClientFactory;
    return { factory, getUser } as const;
}

function createRequest(pathname: string, cookies?: string, method = "GET") {
    const url = new URL(pathname, "https://example.com");
    const headers = cookies ? { cookie: cookies } : undefined;
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

    it("allows platform login without session", async () => {
        const response = await proxy(createRequest("/platform/login"), undefined, {
            createClient: factory,
        });
        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.status, 200);
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
