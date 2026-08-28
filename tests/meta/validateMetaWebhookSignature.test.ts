import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { isValidMetaWebhookSignature } from "../../lib/meta/validateMetaWebhookSignature";

describe("validateMetaWebhookSignature", () => {
    it("aceita assinatura com WHATSAPP_APP_SECRET quando META_APP_SECRET difere", () => {
        const body = '{"object":"instagram"}';
        const waSecret = "wa-secret-test";
        const metaSecret = "meta-secret-wrong";
        process.env.WHATSAPP_APP_SECRET = waSecret;
        process.env.META_APP_SECRET = metaSecret;

        const sig =
            "sha256=" + createHmac("sha256", waSecret).update(body, "utf8").digest("hex");
        assert.equal(isValidMetaWebhookSignature(body, sig), true);

        delete process.env.WHATSAPP_APP_SECRET;
        delete process.env.META_APP_SECRET;
    });
});
