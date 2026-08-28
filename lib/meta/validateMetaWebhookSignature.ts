import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveMetaAppSecret } from "@/lib/meta/metaAppCredentials";

function matchesSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
    if (!secret || !signatureHeader.startsWith("sha256=")) return false;
    const receivedHex = signatureHeader.slice("sha256=".length).trim();
    if (!receivedHex) return false;
    const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const receivedBuf = Buffer.from(receivedHex, "hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (receivedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(receivedBuf, expectedBuf);
}

/** Tenta todos os app secrets configurados (WA e IG usam o mesmo app na plataforma). */
export function isValidMetaWebhookSignature(
    rawBody: string,
    signatureHeader: string | null
): boolean {
    if (!signatureHeader) return false;

    const candidates = new Set<string>();
    for (const key of [
        "META_APP_SECRET",
        "WHATSAPP_APP_SECRET",
        "FACEBOOK_APP_SECRET",
    ] as const) {
        const v = process.env[key]?.trim();
        if (v) candidates.add(v);
    }
    const resolved = resolveMetaAppSecret();
    if (resolved) candidates.add(resolved);

    for (const secret of candidates) {
        if (matchesSignature(rawBody, signatureHeader, secret)) return true;
    }
    return false;
}
