import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exchangeEmbeddedSignupCode } from "../../lib/channels/exchangeEmbeddedSignupCode";
import { isFacebookSignupOrigin } from "../../lib/meta/loadFacebookSdk";
import { embeddedSignupCompleteBodySchema } from "../../src/domain/contracts/embeddedSignup";

describe("exchangeEmbeddedSignupCode", () => {
    it("rejeita code vazio sem chamar Graph", async () => {
        await assert.rejects(() => exchangeEmbeddedSignupCode("   "), /embedded_signup_code_required/);
    });
});

describe("embeddedSignupCompleteBodySchema", () => {
    it("aceita FINISH coexistence e rejeita company_id", () => {
        const ok = embeddedSignupCompleteBodySchema.safeParse({
            code: "abcdefghij",
            event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
            wabaId: "1234567890",
            phoneNumberId: "109876",
        });
        assert.equal(ok.success, true);
        const bad = embeddedSignupCompleteBodySchema.safeParse({
            code: "x",
            event: "FINISH",
            wabaId: "1",
            company_id: "should-be-ignored",
        });
        assert.equal(bad.success, false);
    });
});

describe("isFacebookSignupOrigin", () => {
    it("só aceita origens oficiais da Meta", () => {
        assert.equal(isFacebookSignupOrigin("https://www.facebook.com"), true);
        assert.equal(isFacebookSignupOrigin("https://web.facebook.com"), true);
        assert.equal(isFacebookSignupOrigin("https://evil.example"), false);
    });
});
