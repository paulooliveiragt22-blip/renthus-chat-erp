import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

describe("web menu sessionToken v1/v2", () => {
    before(() => {
        if (!process.env.WEB_MENU_SESSION_SECRET) {
            process.env.WEB_MENU_SESSION_SECRET = "test-secret-session-token-v2";
        }
    });

    it("assina e verifica link v1 (legado)", async () => {
        const { signWebMenuLinkToken, verifyWebMenuLinkToken } = await import(
            "@/lib/public-menu/sessionToken"
        );
        const token = signWebMenuLinkToken({
            companyId: "11111111-1111-1111-1111-111111111111",
            phoneE164: "+5511999999999",
            slug: "loja-demo",
        });
        const parsed = verifyWebMenuLinkToken(token);
        assert.ok(parsed);
        assert.equal(parsed.v, 1);
        if (parsed.v === 1) {
            assert.equal(parsed.phoneE164, "+5511999999999");
        }
    });

    it("assina e verifica link v2 (canal + externalId)", async () => {
        const { signWebMenuChannelLinkToken, verifyWebMenuLinkToken } = await import(
            "@/lib/public-menu/sessionToken"
        );
        const token = signWebMenuChannelLinkToken({
            companyId: "11111111-1111-1111-1111-111111111111",
            slug: "loja-demo",
            channel: "instagram",
            externalId: "17841400000000000",
        });
        const parsed = verifyWebMenuLinkToken(token);
        assert.ok(parsed);
        assert.equal(parsed.v, 2);
        if (parsed.v === 2) {
            assert.equal(parsed.channel, "instagram");
            assert.equal(parsed.externalId, "17841400000000000");
        }
    });

    it("checkout session permite needsPhone sem phoneE164", async () => {
        const { signWebMenuCheckoutSession, verifyWebMenuCheckoutSession } = await import(
            "@/lib/public-menu/sessionToken"
        );
        const token = signWebMenuCheckoutSession({
            companyId: "11111111-1111-1111-1111-111111111111",
            customerId: "22222222-2222-2222-2222-222222222222",
            phoneE164: "",
            slug: "loja-demo",
            channel: "messenger",
            externalId: "psid-12345",
            needsPhone: true,
        });
        const parsed = verifyWebMenuCheckoutSession(token);
        assert.ok(parsed);
        assert.equal(parsed.needsPhone, true);
        assert.equal(parsed.phoneE164, "");
    });

    it("checkout session sem phone e sem needsPhone é inválida", async () => {
        const { signWebMenuCheckoutSession, verifyWebMenuCheckoutSession } = await import(
            "@/lib/public-menu/sessionToken"
        );
        const token = signWebMenuCheckoutSession({
            companyId: "11111111-1111-1111-1111-111111111111",
            customerId: "22222222-2222-2222-2222-222222222222",
            phoneE164: "",
            slug: "loja-demo",
            needsPhone: false,
        });
        assert.equal(verifyWebMenuCheckoutSession(token), null);
    });

    it("assina e verifica token hc (handoff v3)", async () => {
        const { signMenuHandoffToken, verifyMenuHandoffToken } = await import(
            "@/lib/public-menu/sessionToken"
        );
        const token = signMenuHandoffToken({
            handoffId: "33333333-3333-3333-3333-333333333333",
            companyId: "11111111-1111-1111-1111-111111111111",
            slug: "loja-demo",
        });
        const parsed = verifyMenuHandoffToken(token);
        assert.ok(parsed);
        assert.equal(parsed.v, 3);
        assert.equal(parsed.kind, "handoff");
        assert.equal(parsed.slug, "loja-demo");
        assert.equal(parsed.handoffId, "33333333-3333-3333-3333-333333333333");
    });
});
