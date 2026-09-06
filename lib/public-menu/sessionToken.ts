import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessagingChannel } from "@/src/domain/contracts/identity";

/** Link legado WhatsApp (só telefone). */
export type WebMenuLinkPayloadV1 = {
    v: 1;
    companyId: string;
    phoneE164: string;
    slug: string;
    exp: number;
};

/** Link omnichannel: WA=phone, IG=IGSID, Messenger=PSID. */
export type WebMenuLinkPayloadV2 = {
    v: 2;
    companyId: string;
    slug: string;
    channel: MessagingChannel;
    externalId: string;
    exp: number;
};

export type WebMenuLinkPayload = WebMenuLinkPayloadV1 | WebMenuLinkPayloadV2;

/** Token `hc` do handoff bot → cardápio (carrinho no servidor, não na URL). */
export type MenuHandoffTokenPayload = {
    v: 3;
    kind: "handoff";
    handoffId: string;
    companyId: string;
    slug: string;
    exp: number;
};

export type WebMenuCheckoutSession = {
    v: 1 | 2;
    companyId: string;
    customerId: string;
    /** Vazio quando `needsPhone` (1º checkout IG/Messenger). */
    phoneE164: string;
    slug: string;
    name: string | null;
    channel?: MessagingChannel;
    externalId?: string;
    needsPhone?: boolean;
    exp: number;
};

function secret(): string {
    // B2: never fall back to SUPABASE_SERVICE_ROLE_KEY (forging menu session = DB key).
    const s = process.env.WEB_MENU_SESSION_SECRET?.trim() || "";
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

/** Cardápio / checkout — link reutilizável por alguns dias. */
export const WEB_MENU_LINK_TTL_SEC = 7 * 24 * 60 * 60;
/** Meus pedidos — link curto (one-shot / bearer). */
export const WEB_MENU_ORDERS_LINK_TTL_SEC = 15 * 60;
const LINK_TTL_SEC = WEB_MENU_LINK_TTL_SEC;
const SESSION_TTL_SEC = 24 * 60 * 60;
const HANDOFF_TTL_SEC = 2 * 60 * 60;

/** @deprecated Prefer `signWebMenuChannelLinkToken` (v2). Mantido para links WA legados. */
export function signWebMenuLinkToken(input: {
    companyId: string;
    phoneE164: string;
    slug: string;
    ttlSec?: number;
}): string {
    const payload: WebMenuLinkPayloadV1 = {
        v: 1,
        companyId: input.companyId,
        phoneE164: input.phoneE164,
        slug: input.slug,
        exp: Math.floor(Date.now() / 1000) + (input.ttlSec ?? LINK_TTL_SEC),
    };
    return encodeToken(payload);
}

export function signWebMenuChannelLinkToken(input: {
    companyId: string;
    slug: string;
    channel: MessagingChannel;
    externalId: string;
    ttlSec?: number;
}): string {
    const payload: WebMenuLinkPayloadV2 = {
        v: 2,
        companyId: input.companyId,
        slug: input.slug,
        channel: input.channel,
        externalId: input.externalId.trim(),
        exp: Math.floor(Date.now() / 1000) + (input.ttlSec ?? LINK_TTL_SEC),
    };
    return encodeToken(payload);
}

export function verifyWebMenuLinkToken(token: string): WebMenuLinkPayload | null {
    const p = decodeToken<WebMenuLinkPayload & { v?: number }>(token);
    if (!p || !p.companyId || !p.slug) return null;

    if (p.v === 1) {
        const v1 = p as WebMenuLinkPayloadV1;
        if (!v1.phoneE164) return null;
        return v1;
    }

    if (p.v === 2) {
        const v2 = p as WebMenuLinkPayloadV2;
        if (!v2.channel || !v2.externalId?.trim()) return null;
        if (!["whatsapp", "instagram", "messenger", "web"].includes(v2.channel)) {
            return null;
        }
        return v2;
    }

    return null;
}

export function signWebMenuCheckoutSession(input: {
    companyId: string;
    customerId: string;
    phoneE164: string;
    slug: string;
    name?: string | null;
    channel?: MessagingChannel;
    externalId?: string;
    needsPhone?: boolean;
    ttlSec?: number;
}): string {
    const payload: WebMenuCheckoutSession = {
        v: input.channel ? 2 : 1,
        companyId: input.companyId,
        customerId: input.customerId,
        phoneE164: input.phoneE164 ?? "",
        slug: input.slug,
        name: input.name ?? null,
        channel: input.channel,
        externalId: input.externalId,
        needsPhone: Boolean(input.needsPhone),
        exp: Math.floor(Date.now() / 1000) + (input.ttlSec ?? SESSION_TTL_SEC),
    };
    return encodeToken(payload);
}

export function signMenuHandoffToken(input: {
    handoffId: string;
    companyId: string;
    slug: string;
    ttlSec?: number;
}): string {
    const payload: MenuHandoffTokenPayload = {
        v: 3,
        kind: "handoff",
        handoffId: input.handoffId,
        companyId: input.companyId,
        slug: input.slug,
        exp: Math.floor(Date.now() / 1000) + (input.ttlSec ?? HANDOFF_TTL_SEC),
    };
    return encodeToken(payload);
}

export function verifyMenuHandoffToken(token: string): MenuHandoffTokenPayload | null {
    const p = decodeToken<MenuHandoffTokenPayload>(token);
    if (!p || p.v !== 3 || p.kind !== "handoff") return null;
    if (!p.handoffId || !p.companyId || !p.slug) return null;
    return p;
}

export function verifyWebMenuCheckoutSession(token: string): WebMenuCheckoutSession | null {
    const p = decodeToken<WebMenuCheckoutSession>(token);
    if (!p || (p.v !== 1 && p.v !== 2) || !p.companyId || !p.customerId || !p.slug) {
        return null;
    }
    if (p.needsPhone) {
        return p;
    }
    if (!p.phoneE164) return null;
    return p;
}
