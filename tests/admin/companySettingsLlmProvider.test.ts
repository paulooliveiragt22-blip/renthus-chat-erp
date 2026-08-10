/**
 * `app/api/admin/company-settings/route.ts`: RBAC específica de `llm_provider` (Fase 8 do plano
 * multi-provider) — staff não pode alterar o motor de IA mesmo podendo alterar outros campos da
 * mesma rota. Sem allowlist de piloto: qualquer owner/admin pode setar `anthropic` ou `openai`
 * (decisão revertida depois da Fase 8 — ver docs/PLANO_MULTI_PROVIDER_IA.md).
 */
import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it } from "node:test";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: () => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PATCH: (req: any) => Promise<any>;

let currentRole = "owner";
const upsertCalls: Array<Record<string, unknown>> = [];

function setCachedModule(
    cache: Record<string, unknown>,
    basePathWithoutExt: string,
    exports: Record<string, unknown>
) {
    for (const ext of [".js", ".ts"]) {
        const p = basePathWithoutExt + ext;
        cache[p] = { id: p, filename: p, loaded: true, exports };
    }
}

function fakeAdmin() {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.maybeSingle = async () => ({
        data: { require_order_approval: false, auto_print_orders: true, llm_provider: null },
        error: null,
    });
    chain.upsert = (patch: Record<string, unknown>) => {
        upsertCalls.push(patch);
        return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
    };
    return { from: () => chain };
}

before(async () => {
    const root = join(__dirname, "..", "..");
    const requireAccessBase = join(root, "lib", "workspace", "requireCompanyAccess");
    const targetBase = join(root, "app", "api", "admin", "company-settings", "route");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;
    for (const base of [targetBase, requireAccessBase]) {
        delete cache[base + ".js"];
        delete cache[base + ".ts"];
    }

    setCachedModule(cache, requireAccessBase, {
        requireCompanyAccess: async (allowedRoles?: string[]) => {
            if (allowedRoles && !allowedRoles.includes(currentRole)) {
                return { ok: false, status: 403, error: "Insufficient role" };
            }
            return {
                ok: true,
                companyId: "company-pilot",
                userId: "u1",
                role: currentRole,
                admin: fakeAdmin(),
            };
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(targetBase + ".js");
    GET = mod.GET;
    PATCH = mod.PATCH;
});

beforeEach(() => {
    upsertCalls.length = 0;
});

describe("PATCH /api/admin/company-settings — llm_provider", () => {
    afterEach(() => {
        currentRole = "owner";
    });

    it("staff tentando setar llm_provider recebe 403 (não altera outros campos existentes)", async () => {
        currentRole = "staff";
        const res = await PATCH({
            json: async () => ({ llm_provider: "anthropic", auto_print_orders: true }),
        });
        assert.equal(res.status, 403);
        assert.equal(upsertCalls.length, 0);
    });

    it("staff continua podendo setar campos que não são llm_provider", async () => {
        currentRole = "staff";
        const res = await PATCH({ json: async () => ({ auto_print_orders: false }) });
        assert.equal(res.status, 200);
        assert.equal(upsertCalls.length, 1);
        assert.equal(upsertCalls[0]?.llm_provider, undefined);
    });

    it("owner consegue setar llm_provider=anthropic (sempre permitido)", async () => {
        currentRole = "owner";
        const res = await PATCH({ json: async () => ({ llm_provider: "anthropic" }) });
        assert.equal(res.status, 200);
        assert.equal(upsertCalls[0]?.llm_provider, "anthropic");
    });

    it("admin consegue setar llm_provider=openai (sem allowlist de piloto)", async () => {
        currentRole = "admin";
        const res = await PATCH({ json: async () => ({ llm_provider: "openai" }) });
        assert.equal(res.status, 200);
        assert.equal(upsertCalls[0]?.llm_provider, "openai");
    });

    it("valor inválido de llm_provider é rejeitado (400)", async () => {
        currentRole = "owner";
        const res = await PATCH({ json: async () => ({ llm_provider: "gemini" }) });
        assert.equal(res.status, 400);
    });
});

describe("GET /api/admin/company-settings", () => {
    it("devolve llm_provider", async () => {
        currentRole = "staff";
        const res = await GET();
        const body = await res.json();
        assert.equal(body.settings.llm_provider, null);
    });
});
