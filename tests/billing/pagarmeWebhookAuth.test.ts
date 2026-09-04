import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
    assertPagarmeWebhookAuth,
    parseBasicAuthorizationHeader,
    verifyPagarmeWebhookBasicAuth,
    verifyPagarmeWebhookHmacSignature,
    type PagarmeWebhookAuthEnv,
} from "@/lib/billing/pagarmeWebhookAuth";

function basicHeader(user: string, password: string): string {
    return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

const prodEnv = (over: Partial<PagarmeWebhookAuthEnv> = {}): PagarmeWebhookAuthEnv => ({
    basicUser: "hook_user",
    basicPassword: "hook_pass",
    hmacSecret: undefined,
    allowInsecure: false,
    isProduction: true,
    ...over,
});

describe("parseBasicAuthorizationHeader", () => {
    it("parseia Basic user:pass", () => {
        const p = parseBasicAuthorizationHeader(basicHeader("u", "p:with:colons"));
        assert.deepEqual(p, { user: "u", password: "p:with:colons" });
    });

    it("retorna null se malformado", () => {
        assert.equal(parseBasicAuthorizationHeader(null), null);
        assert.equal(parseBasicAuthorizationHeader("Bearer x"), null);
        assert.equal(parseBasicAuthorizationHeader("Basic !!!"), null);
    });
});

describe("verifyPagarmeWebhookBasicAuth", () => {
    it("aceita credenciais corretas (timing-safe)", () => {
        assert.equal(
            verifyPagarmeWebhookBasicAuth(basicHeader("a", "b"), "a", "b"),
            true
        );
    });

    it("rejeita user ou senha errados", () => {
        assert.equal(
            verifyPagarmeWebhookBasicAuth(basicHeader("a", "wrong"), "a", "b"),
            false
        );
        assert.equal(
            verifyPagarmeWebhookBasicAuth(basicHeader("x", "b"), "a", "b"),
            false
        );
    });
});

describe("verifyPagarmeWebhookHmacSignature", () => {
    it("aceita HMAC-SHA256 hex com ou sem prefixo sha256=", () => {
        const body = '{"type":"order.paid"}';
        const secret = "s3cret";
        const hex = createHmac("sha256", secret).update(body, "utf8").digest("hex");
        assert.equal(verifyPagarmeWebhookHmacSignature(body, hex, secret), true);
        assert.equal(
            verifyPagarmeWebhookHmacSignature(body, `sha256=${hex}`, secret),
            true
        );
    });

    it("rejeita assinatura inválida ou lengths diferentes", () => {
        const body = "{}";
        assert.equal(
            verifyPagarmeWebhookHmacSignature(body, "deadbeef", "s"),
            false
        );
        assert.equal(verifyPagarmeWebhookHmacSignature(body, "zz", "s"), false);
    });
});

describe("assertPagarmeWebhookAuth (L1 Basic + HMAC legado)", () => {
    it("prod sem Basic configurado → 503", () => {
        const r = assertPagarmeWebhookAuth({
            authorization: null,
            signatureHeader: null,
            rawBody: "{}",
            env: prodEnv({ basicUser: undefined, basicPassword: undefined }),
        });
        assert.deepEqual(r, {
            ok: false,
            status: 503,
            error: "auth_not_configured",
        });
    });

    it("prod com Basic errado → 401", () => {
        const r = assertPagarmeWebhookAuth({
            authorization: basicHeader("hook_user", "nope"),
            signatureHeader: null,
            rawBody: "{}",
            env: prodEnv(),
        });
        assert.deepEqual(r, { ok: false, status: 401, error: "unauthorized" });
    });

    it("prod com Basic ok → aceita (v5 sem HMAC)", () => {
        const r = assertPagarmeWebhookAuth({
            authorization: basicHeader("hook_user", "hook_pass"),
            signatureHeader: null,
            rawBody: "{}",
            env: prodEnv(),
        });
        assert.deepEqual(r, { ok: true });
    });

    it("prod + HMAC header inválido → 401 mesmo com Basic ok", () => {
        const r = assertPagarmeWebhookAuth({
            authorization: basicHeader("hook_user", "hook_pass"),
            signatureHeader: "sha256=00",
            rawBody: "{}",
            env: prodEnv({ hmacSecret: "hmac" }),
        });
        assert.deepEqual(r, {
            ok: false,
            status: 401,
            error: "invalid_signature",
        });
    });

    it("prod + ALLOW_INSECURE sem Basic → aceita", () => {
        const r = assertPagarmeWebhookAuth({
            authorization: null,
            signatureHeader: null,
            rawBody: "{}",
            env: prodEnv({
                basicUser: undefined,
                basicPassword: undefined,
                allowInsecure: true,
            }),
        });
        assert.deepEqual(r, { ok: true });
    });

    it("non-prod sem Basic → aceita", () => {
        const r = assertPagarmeWebhookAuth({
            authorization: null,
            signatureHeader: null,
            rawBody: "{}",
            env: prodEnv({
                isProduction: false,
                basicUser: undefined,
                basicPassword: undefined,
            }),
        });
        assert.deepEqual(r, { ok: true });
    });

    it("non-prod com Basic configurado → exige match", () => {
        const bad = assertPagarmeWebhookAuth({
            authorization: null,
            signatureHeader: null,
            rawBody: "{}",
            env: prodEnv({ isProduction: false }),
        });
        assert.equal(bad.ok, false);
        const ok = assertPagarmeWebhookAuth({
            authorization: basicHeader("hook_user", "hook_pass"),
            signatureHeader: null,
            rawBody: "{}",
            env: prodEnv({ isProduction: false }),
        });
        assert.deepEqual(ok, { ok: true });
    });
});
