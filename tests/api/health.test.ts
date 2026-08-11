import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";

let healthGet: () => Promise<Response>;

function makeChain(result: { error: unknown }) {
    const chain: Record<string, unknown> = {
        select: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve),
    };
    return chain;
}

function loadHealthRoute(dbError: unknown) {
    const distRoot = join(__dirname, "..", "..");
    const adminPath = join(distRoot, "lib", "supabase", "admin.js");
    const routePath = join(distRoot, "app", "api", "health", "route.js");

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cache = (require as any).cache as Record<string, unknown>;

    cache[adminPath] = {
        id: adminPath,
        filename: adminPath,
        loaded: true,
        exports: {
            createAdminClient: () => ({
                from: () => makeChain({ error: dbError }),
            }),
        },
    };

    delete cache[routePath];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(routePath).GET as () => Promise<Response>;
}

describe("GET /api/health", () => {
    it("db up → 200 { ok: true, db: 'up' }", async () => {
        healthGet = loadHealthRoute(null);
        const res = await healthGet();
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.ok, true);
        assert.equal(body.db, "up");
        assert.equal(typeof body.ts, "string");
        assert.equal(typeof body.latencyMs, "number");
    });

    it("db down → 503 { ok: false, db: 'down' }", async () => {
        healthGet = loadHealthRoute({ message: "connection refused" });
        const res = await healthGet();
        const body = await res.json();
        assert.equal(res.status, 503);
        assert.equal(body.ok, false);
        assert.equal(body.db, "down");
    });
});
