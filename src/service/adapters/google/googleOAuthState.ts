import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type GoogleOAuthStatePayload = {
    companyId: string;
    userId: string;
    nonce: string;
    exp: number;
};

function signingSecret(): string {
    const secret = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim() ?? "";
    if (!secret) throw new Error("oauth_signing_secret_missing");
    return secret;
}

function sign(payloadB64: string): string {
    return createHmac("sha256", signingSecret()).update(payloadB64).digest("base64url");
}

export function createGoogleOAuthState(companyId: string, userId: string, ttlMs = 15 * 60_000): string {
    const payload: GoogleOAuthStatePayload = {
        companyId,
        userId,
        nonce: randomBytes(16).toString("hex"),
        exp: Date.now() + ttlMs,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${payloadB64}.${sign(payloadB64)}`;
}

export function parseGoogleOAuthState(state: string): { companyId: string; userId: string } | null {
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
        const json = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as GoogleOAuthStatePayload;
        if (!json?.companyId || !json.userId || !json.exp || Date.now() > json.exp) return null;
        return { companyId: json.companyId, userId: json.userId };
    } catch {
        return null;
    }
}
