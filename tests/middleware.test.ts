import assert from "node:assert";
import { beforeEach, describe, it, mock } from "node:test";
import { NextRequest } from "next/server";
import { middleware, type SupabaseClientFactory } from "../middleware";

type MockedClientFactory = SupabaseClientFactory & {
    mock: ReturnType<typeof mock.fn>["mock"];
};

function createMockClient(user: unknown) {
    const getUser = mock.fn(async () => ({ data: { user } }));
    const client = { auth: { getUser } };
    const factory = mock.fn(() => client) as unknown as MockedClientFactory;
    return { factory, getUser } as const;
}

function createRequest(pathname: string, cookies?: string) {
    const url = new URL(pathname, "https://example.com");
    const headers = cookies ? { cookie: cookies } : undefined;
    return new NextRequest(url, { headers });
}

describe("middleware auth routing", () => {
    let factory: MockedClientFactory;

    beforeEach(() => {
        factory = createMockClient(null).factory;
    });

    it("bypasses public auth routes without invoking Supabase", async () => {
        const response = await middleware(createRequest("/login"), undefined, {
            createClient: factory,
        });

        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.headers.get("location"), null);
    });

    it("exempts webhook and print endpoints", async () => {
        const response = await middleware(
            createRequest("/api/whatsapp/inbound"),
            undefined,
            { createClient: factory }
        );
        const printResponse = await middleware(createRequest("/api/print/pull"), undefined, {
            createClient: factory,
        });

        assert.strictEqual(factory.mock.calls.length, 0);
        assert.strictEqual(response.headers.get("location"), null);
        assert.strictEqual(printResponse.headers.get("location"), null);
    });

    it("redirects unauthenticated users on protected routes", async () => {
        const { factory: protectedFactory } = createMockClient(null);
        const response = await middleware(createRequest("/dashboard"), undefined, {
            createClient: protectedFactory,
        });

        assert.strictEqual(protectedFactory.mock.calls.length, 1);
        assert.strictEqual(response.status, 307);
        assert.strictEqual(response.headers.get("location"), "https://example.com/login");
    });

    it("allows protected routes when a session exists", async () => {
        const { factory: protectedFactory, getUser } = createMockClient({ id: "user-123" });
        const response = await middleware(createRequest("/dashboard"), undefined, {
            createClient: protectedFactory,
        });

        assert.strictEqual(protectedFactory.mock.calls.length, 1);
        assert.strictEqual(getUser.mock.calls.length, 1);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get("location"), null);
    });
});
