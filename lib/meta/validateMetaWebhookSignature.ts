import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
    resolveInstagramAppSecret,
    resolveMetaAppSecret,
} from "@/lib/meta/metaAppCredentials";

const SECRET_ENV_KEYS = [
    "META_APP_SECRET",
    "WHATSAPP_APP_SECRET",
    "FACEBOOK_APP_SECRET",
    "META_INSTAGRAM_APP_SECRET",
    "INSTAGRAM_APP_SECRET",
] as const;

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

export function collectMetaWebhookSecrets(
    env: NodeJS.ProcessEnv = process.env
): Set<string> {
    const candidates = new Set<string>();
    for (const key of SECRET_ENV_KEYS) {
        const v = env[key]?.trim();
        if (v) candidates.add(v);
    }
    // Resolved helpers leem process.env — só úteis no runtime real
    if (env === process.env) {
        for (const resolved of [resolveMetaAppSecret(), resolveInstagramAppSecret()]) {
            if (resolved) candidates.add(resolved);
        }
    }
    return candidates;
}

export function isMetaWebhookSecretConfigured(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    return collectMetaWebhookSecrets(env).size > 0;
}

function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

/**
 * B9: em produção, sem nenhum app secret → 503 (não processa como 401 genérico).
 */
export function assertMetaWebhookSecretsReady(
    env: NodeJS.ProcessEnv = process.env
): { ok: true } | { ok: false; status: 503; error: "server_misconfigured" } {
    if (!isProductionEnv(env)) return { ok: true };
    if (!isMetaWebhookSecretConfigured(env)) {
        return { ok: false, status: 503, error: "server_misconfigured" };
    }
    return { ok: true };
}

/** Tenta todos os app secrets configurados (WA e IG usam o mesmo app na plataforma). */
export function isValidMetaWebhookSignature(
    rawBody: string,
    signatureHeader: string | null,
    env: NodeJS.ProcessEnv = process.env
): boolean {
    if (!signatureHeader) return false;

    for (const secret of collectMetaWebhookSecrets(env)) {
        if (matchesSignature(rawBody, signatureHeader, secret)) return true;
    }
    return false;
}
