import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type WebMenuLinkPayload = {
    v: 1;
    companyId: string;
    phoneE164: string;
    slug: string;
    exp: number;
};

export type WebMenuCheckoutSession = {
    v: 1;
    companyId: string;
    customerId: string;
    phoneE164: string;
    slug: string;
    name: string | null;
    exp: number;
};

function secret(): string {
    const s =
        process.env.WEB_MENU_SESSION_SECRET?.trim() ||
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
        "";
    if (!s) {
        throw new Error("WEB_MENU_SESSION_SECRET_missing");
    }
    return s;
}

function b64url(buf: Buffer | string): string {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
    return b.toString("base64url");
}

function signRaw(payloadB64: string): string {
    return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

function encodeToken(payload: object): string {
    const payloadB64 = b64url(JSON.stringify(payload));
    return `${payloadB64}.${signRaw(payloadB64)}`;
}

function decodeToken<T extends { exp: number }>(token: string): T | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payloadB64, sig] = parts as [string, string];
    const expected = signRaw(payloadB64);
    try {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
        return null;
    }
    try {
        const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as T;
        if (!parsed || typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

const LINK_TTL_SEC = 7 * 24 * 60 * 60;
const SESSION_TTL_SEC = 24 * 60 * 60;

export function signWebMenuLinkToken(input: {
    companyId: string;
    phoneE164: string;
    slug: string;
    ttlSec?: number;
}): string {
    const payload: WebMenuLinkPayload = {
        v: 1,
        companyId: input.companyId,
        phoneE164: input.phoneE164,
        slug: input.slug,
        exp: Math.floor(Date.now() / 1000) + (input.ttlSec ?? LINK_TTL_SEC),
    };
    return encodeToken(payload);
}

export function verifyWebMenuLinkToken(token: string): WebMenuLinkPayload | null {
    const p = decodeToken<WebMenuLinkPayload>(token);
    if (!p || p.v !== 1 || !p.companyId || !p.phoneE164 || !p.slug) return null;
    return p;
}

export function signWebMenuCheckoutSession(input: {
    companyId: string;
    customerId: string;
    phoneE164: string;
    slug: string;
    name?: string | null;
    ttlSec?: number;
}): string {
    const payload: WebMenuCheckoutSession = {
        v: 1,
        companyId: input.companyId,
        customerId: input.customerId,
        phoneE164: input.phoneE164,
        slug: input.slug,
        name: input.name ?? null,
        exp: Math.floor(Date.now() / 1000) + (input.ttlSec ?? SESSION_TTL_SEC),
    };
    return encodeToken(payload);
}

export function verifyWebMenuCheckoutSession(token: string): WebMenuCheckoutSession | null {
    const p = decodeToken<WebMenuCheckoutSession>(token);
    if (!p || p.v !== 1 || !p.companyId || !p.customerId || !p.phoneE164 || !p.slug) {
        return null;
    }
    return p;
}
