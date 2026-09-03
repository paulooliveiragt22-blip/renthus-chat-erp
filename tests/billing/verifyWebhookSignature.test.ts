import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Espelha o strip de `verifyWebhookSignature` (pagarme.ts).
 * Mantido puro aqui porque `pagarme.ts` é `server-only`.
 */
function normalizeWebhookSigHeader(signature: string): string {
    return signature.replace(/^sha256=/i, "").trim();
}

describe("normalizeWebhookSigHeader (bug 500 replaceAll sem /g)", () => {
    it("não lança com header vazio", () => {
        assert.equal(normalizeWebhookSigHeader(""), "");
    });

    it("remove prefixo sha256=", () => {
        assert.equal(normalizeWebhookSigHeader("sha256=abc"), "abc");
        assert.equal(normalizeWebhookSigHeader("SHA256=xyz"), "xyz");
    });

    it("replaceAll sem flag g lançaria TypeError — documenta o contrato", () => {
        assert.throws(
            () => "".replaceAll(/^sha256=/i, ""),
            (err: unknown) =>
                err instanceof TypeError &&
                String(err.message).includes("non-global RegExp")
        );
    });
});
