import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMetaOAuthState, parseMetaOAuthState } from "@/lib/meta/oauthState";

describe("meta oauth state", () => {
    it("round-trip assina e valida companyId", () => {
        process.env.CREDENTIALS_ENCRYPTION_KEY =
            process.env.CREDENTIALS_ENCRYPTION_KEY || "test-signing-secret-for-oauth-state";
        const state = createMetaOAuthState("11111111-1111-1111-1111-111111111111");
        const parsed = parseMetaOAuthState(state);
        assert.equal(parsed?.companyId, "11111111-1111-1111-1111-111111111111");
    });

    it("rejeita assinatura adulterada", () => {
        process.env.CREDENTIALS_ENCRYPTION_KEY =
            process.env.CREDENTIALS_ENCRYPTION_KEY || "test-signing-secret-for-oauth-state";
        const state = createMetaOAuthState("11111111-1111-1111-1111-111111111111");
        const bad = state.slice(0, -4) + "xxxx";
        assert.equal(parseMetaOAuthState(bad), null);
    });
});
