import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { validateCronAuthorization } from "../../lib/security/cronAuth";

describe("validateCronAuthorization (R6.1)", () => {
    const prevEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...prevEnv };
    });

    it("dev sem CRON_SECRET → allow (convenience)", () => {
        delete process.env.CRON_SECRET;
        delete process.env.VERCEL_ENV;
        const res = validateCronAuthorization(null);
        assert.strictEqual(res, null);
    });

    it("com secret → Bearer correto passa", () => {
        process.env.CRON_SECRET = "secret-123";
        assert.strictEqual(
            validateCronAuthorization("Bearer secret-123", { vercelCronHeader: "1" }),
            null
        );
    });

    it("com secret → Bearer errado → 401", () => {
        process.env.CRON_SECRET = "secret-123";
        const res = validateCronAuthorization("Bearer wrong");
        assert.ok(res);
        assert.strictEqual(res!.status, 401);
    });

    it("prod sem CRON_SECRET → 500 server_misconfigured", () => {
        delete process.env.CRON_SECRET;
        process.env.VERCEL_ENV = "production";
        const res = validateCronAuthorization("Bearer anything");
        assert.ok(res);
        assert.strictEqual(res!.status, 500);
        delete process.env.VERCEL_ENV;
    });

    it("x-vercel-cron sozinho não autentica (precisa Bearer)", () => {
        process.env.CRON_SECRET = "secret-123";
        const res = validateCronAuthorization(null, { vercelCronHeader: "1" });
        assert.ok(res);
        assert.strictEqual(res!.status, 401);
    });
});
