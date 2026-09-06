/**
 * Auth for server-to-server calls to chatbot resolve (not Supabase service_role).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateInternalChatbotSecret } from "../../lib/security/internalChatbotAuth";

describe("validateInternalChatbotSecret", () => {
    it("accepts matching INTERNAL_CHATBOT_SECRET", () => {
        const r = validateInternalChatbotSecret("s3cret", {
            INTERNAL_CHATBOT_SECRET: "s3cret",
            NODE_ENV: "test",
        });
        assert.deepEqual(r, { ok: true });
    });

    it("rejects wrong key", () => {
        const r = validateInternalChatbotSecret("nope", {
            INTERNAL_CHATBOT_SECRET: "s3cret",
            NODE_ENV: "test",
        });
        assert.equal(r.ok, false);
        if (!r.ok) {
            assert.equal(r.status, 401);
            assert.equal(r.error, "unauthorized");
        }
    });

    it("rejects service_role lookalike when secret differs", () => {
        const r = validateInternalChatbotSecret("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service", {
            INTERNAL_CHATBOT_SECRET: "internal-only",
            SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service",
            NODE_ENV: "test",
        });
        assert.equal(r.ok, false);
    });

    it("fail-closed in production when secret missing", () => {
        const r = validateInternalChatbotSecret("anything", {
            NODE_ENV: "production",
            VERCEL_ENV: "production",
        });
        assert.equal(r.ok, false);
        if (!r.ok) {
            assert.equal(r.status, 500);
            assert.equal(r.error, "server_misconfigured");
        }
    });

    it("unauthorized in non-prod when secret missing", () => {
        const r = validateInternalChatbotSecret("anything", {
            NODE_ENV: "development",
        });
        assert.equal(r.ok, false);
        if (!r.ok) {
            assert.equal(r.status, 401);
        }
    });
});
