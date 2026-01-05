import assert from "node:assert/strict";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

const originalEnv = { ...process.env };
const modulePath = path.join(__dirname, "env");

function loadEnvModule() {
    delete require.cache[require.resolve(modulePath)];
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    return require(modulePath) as typeof import("./env");
}

describe("Supabase env validation", () => {
    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    it("throws when required variables are missing", () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        assert.throws(() => loadEnvModule().loadSupabaseEnv());
    });

    it("throws when URL is invalid", () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

        assert.throws(() => loadEnvModule().loadSupabaseEnv());
    });

    it("loads when all variables are present", () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

        const env = loadEnvModule().loadSupabaseEnv();
        assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "https://example.supabase.co");
        assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "anon");
        assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "service");
    });
});
