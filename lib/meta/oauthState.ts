import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveMetaAppSecret } from "@/lib/meta/metaAppCredentials";

type OAuthStatePayload = {
    companyId: string;
    nonce: string;
    exp: number;
};

function signingSecret(): string {
    const s =
        process.env.CREDENTIALS_ENCRYPTION_KEY?.trim() ||
        resolveMetaAppSecret() ||
        process.env.CRON_SECRET?.trim() ||
        "";
    if (!s) throw new Error("oauth_signing_secret_missing");
    return s;
}

function sign(payloadB64: string): string {
    return createHmac("sha256", signingSecret()).update(payloadB64).digest("base64url");
}

export function createMetaOAuthState(companyId: string, ttlMs = 15 * 60_000): string {
    const payload: OAuthStatePayload = {
        companyId,
        nonce: crypto.randomUUID().replace(/-/g, ""),
        exp: Date.now() + ttlMs,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${payloadB64}.${sign(payloadB64)}`;
}

export function parseMetaOAuthState(state: string): { companyId: string } | null {
    const raw = String(state ?? "").trim();
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;
    const payloadB64 = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expected = sign(payloadB64);
    try {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
        return null;
    }
    try {
        const json = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as OAuthStatePayload;
        if (!json?.companyId || !json.exp || Date.now() > json.exp) return null;
        return { companyId: json.companyId };
    } catch {
        return null;
    }
}
