import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
    SIGNUP_CONFLICT_MESSAGE,
    assertNoPlanIdInPublicOffer,
    signupCnpjRateLimitKey,
    signupConflictResponse,
    signupEmailRateLimitKey,
    enforceSignupIdentityRateLimits,
    BILLING_SIGNUP_IDENTITY_LIMIT,
} from "../../lib/billing/signupPublicAbuse";
import { resetRateLimitForTests } from "../../lib/security/rateLimit";

describe("signupPublicAbuse (B11)", () => {
    beforeEach(() => resetRateLimitForTests());

    it("conflito 409 usa mensagem única (sem enum e-mail vs CNPJ)", async () => {
        const res = signupConflictResponse();
        assert.equal(res.status, 409);
        const body = (await res.json()) as { error: string };
        assert.equal(body.error, SIGNUP_CONFLICT_MESSAGE);
        assert.equal(body.error.includes("e-mail"), false);
        assert.equal(body.error.toLowerCase().includes("cnpj"), false);
    });

    it("chaves de identidade isolam email e CNPJ", () => {
        assert.equal(
            signupEmailRateLimitKey("a@x.com"),
            "billing_signup_email:a@x.com"
        );
        assert.equal(signupCnpjRateLimitKey("11222333000181"), "billing_signup_cnpj:11222333000181");
    });

    it("rate limit por email após N tentativas", async () => {
        const email = "abuse@example.com";
        const cnpj = "11222333000181";
        for (let i = 0; i < BILLING_SIGNUP_IDENTITY_LIMIT; i++) {
            const ok = await enforceSignupIdentityRateLimits(email, `${cnpj}${i}`);
            assert.equal(ok, null);
        }
        const blocked = await enforceSignupIdentityRateLimits(email, "99888777000166");
        assert.ok(blocked);
        assert.equal(blocked!.status, 429);
    });

    it("oferta pública não pode carregar id de plano", () => {
        assert.equal(
            assertNoPlanIdInPublicOffer({
                key: "pro",
                name: "Pro",
                list_monthly_cents: 1,
            }),
            true
        );
        assert.equal(assertNoPlanIdInPublicOffer({ key: "pro", id: "uuid" }), false);
        assert.equal(assertNoPlanIdInPublicOffer({ key: "pro", plan_id: "uuid" }), false);
    });
});
