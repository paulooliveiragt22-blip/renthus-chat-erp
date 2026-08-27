import assert from "node:assert";
import { describe, it } from "node:test";
import {
    extractClientIp,
    isIpAllowed,
} from "../../lib/platform/checkPlatformIpAllowlist";
import { redactAuditState } from "../../lib/platform/audit/redactAuditState";
import { platformRoleHasPermission } from "../../lib/platform/platformPermissions";

describe("platform ip allowlist", () => {
    it("allows any ip in non-production when list empty", () => {
        assert.strictEqual(isIpAllowed("1.2.3.4", ""), true);
    });

    it("matches exact ip in allowlist when prod env simulated via VERCEL_ENV", () => {
        const prevVercel = process.env.VERCEL_ENV;
        process.env.VERCEL_ENV = "production";
        try {
            assert.strictEqual(
                isIpAllowed("203.0.113.10", "203.0.113.10,198.51.100.0/24"),
                true
            );
            assert.strictEqual(isIpAllowed("203.0.113.11", "203.0.113.10"), false);
        } finally {
            if (prevVercel === undefined) delete process.env.VERCEL_ENV;
            else process.env.VERCEL_ENV = prevVercel;
        }
    });

    it("extracts first forwarded ip", () => {
        assert.strictEqual(extractClientIp("203.0.113.1, 10.0.0.1", null), "203.0.113.1");
    });
});

describe("platform audit redaction", () => {
    it("redacts token fields", () => {
        const out = redactAuditState({
            name: "Acme",
            access_token: "secret",
            nested: { encrypted_access_token: "x" },
        });
        assert.strictEqual(out?.access_token, "[REDACTED]");
        assert.strictEqual(
            (out?.nested as Record<string, unknown>).encrypted_access_token,
            "[REDACTED]"
        );
        assert.strictEqual(out?.name, "Acme");
    });
});

describe("platform permissions matrix", () => {
    it("superadmin has companies.write", () => {
        assert.strictEqual(platformRoleHasPermission("superadmin", "platform.companies.write"), true);
    });

    it("readonly lacks companies.write", () => {
        assert.strictEqual(platformRoleHasPermission("readonly", "platform.companies.write"), false);
    });

    it("support can impersonate", () => {
        assert.strictEqual(platformRoleHasPermission("support", "platform.impersonate"), true);
    });
});

describe("platform impersonation helpers", () => {
    it("detects mutating methods and tenant paths", async () => {
        const {
            isMutatingHttpMethod,
            isTenantMutationPath,
            isImpersonationActive,
        } = await import("../../lib/platform/impersonation");

        assert.strictEqual(isMutatingHttpMethod("POST"), true);
        assert.strictEqual(isMutatingHttpMethod("GET"), false);
        assert.strictEqual(isTenantMutationPath("/api/admin/orders"), true);
        assert.strictEqual(isTenantMutationPath("/api/platform/companies"), false);
        assert.strictEqual(
            isImpersonationActive({
                id: "1",
                platform_user_id: "u",
                company_id: "c",
                reason: "ticket",
                started_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 60_000).toISOString(),
                ended_at: null,
            }),
            true
        );
        assert.strictEqual(
            isImpersonationActive({
                id: "1",
                platform_user_id: "u",
                company_id: "c",
                reason: "ticket",
                started_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 60_000).toISOString(),
                ended_at: new Date().toISOString(),
            }),
            false
        );
    });
});
