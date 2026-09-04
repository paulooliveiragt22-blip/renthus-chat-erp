/**
 * Auth do webhook Pagar.me (Core v5).
 *
 * L1 canônico: HTTP Basic Auth (user/senha definidos no painel do hookset e
 * espelhados em `PAGARME_WEBHOOK_BASIC_USER` / `PAGARME_WEBHOOK_BASIC_PASSWORD`).
 *
 * HMAC (`PAGARME_WEBHOOK_SECRET` + `X-Hub-Signature`) = legado v3/v4: só valida
 * quando secret e header estão presentes. Em v5 o painel não emite HMAC.
 *
 * Fonte da verdade do pago continua sendo GET `/orders/:id` (não esta camada).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type PagarmeWebhookAuthOk = { ok: true };
export type PagarmeWebhookAuthDeny = {
    ok: false;
    status: 401 | 503;
    error: "unauthorized" | "auth_not_configured" | "invalid_signature";
};

export type PagarmeWebhookAuthResult = PagarmeWebhookAuthOk | PagarmeWebhookAuthDeny;

export type PagarmeWebhookAuthEnv = {
    basicUser: string | undefined;
    basicPassword: string | undefined;
    hmacSecret: string | undefined;
    allowInsecure: boolean;
    /** `VERCEL_ENV === "production"` ou equivalente estrito. */
    isProduction: boolean;
};

function timingSafeEqualUtf8(a: string, b: string): boolean {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
}

export function readPagarmeWebhookAuthEnv(
    env: NodeJS.ProcessEnv = process.env
): PagarmeWebhookAuthEnv {
    const vercelEnv = env.VERCEL_ENV?.trim();
    const isProduction =
        vercelEnv === "production" ||
        (!vercelEnv && env.NODE_ENV === "production");

    return {
        basicUser: env.PAGARME_WEBHOOK_BASIC_USER?.trim() || undefined,
        basicPassword: env.PAGARME_WEBHOOK_BASIC_PASSWORD?.trim() || undefined,
        hmacSecret: env.PAGARME_WEBHOOK_SECRET?.trim() || undefined,
        allowInsecure: env.ALLOW_INSECURE_PAGARME_WEBHOOK?.trim() === "1",
        isProduction,
    };
}

/**
 * Extrai user:pass do header `Authorization: Basic …`.
 * Retorna null se ausente/malformado.
 */
export function parseBasicAuthorizationHeader(
    authorization: string | null | undefined
): { user: string; password: string } | null {
    if (!authorization) return null;
    const m = /^Basic\s+(\S+)$/i.exec(authorization.trim());
    if (!m?.[1]) return null;
    let decoded: string;
    try {
        decoded = Buffer.from(m[1], "base64").toString("utf8");
    } catch {
        return null;
    }
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    return {
        user: decoded.slice(0, colon),
        password: decoded.slice(colon + 1),
    };
}

/**
 * Valida Basic Auth contra credenciais configuradas.
 * Se `expectedUser`/`expectedPassword` vazios → não aplica (caller decide).
 */
export function verifyPagarmeWebhookBasicAuth(
    authorization: string | null | undefined,
    expectedUser: string,
    expectedPassword: string
): boolean {
    if (!expectedUser || !expectedPassword) return false;
    const parsed = parseBasicAuthorizationHeader(authorization);
    if (!parsed) return false;
    return (
        timingSafeEqualUtf8(parsed.user, expectedUser) &&
        timingSafeEqualUtf8(parsed.password, expectedPassword)
    );
}

/** Strip `sha256=` e compara HMAC-SHA256 hex com timing-safe. */
export function verifyPagarmeWebhookHmacSignature(
    rawBody: string,
    signatureHeader: string | null | undefined,
    secret: string
): boolean {
    if (!secret) return false;
    const raw = (signatureHeader ?? "").trim();
    if (!raw) return false;
    const sig = raw.replace(/^sha256=/i, "").trim();
    if (!sig) return false;

    const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const receivedBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (receivedBuf.length === 0 || receivedBuf.length !== expectedBuf.length) {
        return false;
    }
    return timingSafeEqual(receivedBuf, expectedBuf);
}

/**
 * Gate L1 do webhook.
 *
 * Produção (sem `ALLOW_INSECURE_PAGARME_WEBHOOK=1`):
 *   - Basic user+password obrigatórios no env → senão 503
 *   - Authorization Basic deve bater → senão 401
 *
 * Non-prod / insecure flag:
 *   - Se Basic configurado → deve bater
 *   - Se Basic ausente → aceita (dev/smoke) só com allowInsecure ou non-prod
 *
 * HMAC: se secret + header presentes → deve bater; senão 401.
 * Sem header → HMAC ignorado (v5).
 */
export function assertPagarmeWebhookAuth(input: {
    authorization: string | null | undefined;
    signatureHeader: string | null | undefined;
    rawBody: string;
    env?: PagarmeWebhookAuthEnv;
}): PagarmeWebhookAuthResult {
    const env = input.env ?? readPagarmeWebhookAuthEnv();
    const requireAuth = env.isProduction && !env.allowInsecure;

    const hasBasic =
        Boolean(env.basicUser?.length) && Boolean(env.basicPassword?.length);

    if (requireAuth && !hasBasic) {
        return { ok: false, status: 503, error: "auth_not_configured" };
    }

    if (hasBasic) {
        const ok = verifyPagarmeWebhookBasicAuth(
            input.authorization,
            env.basicUser!,
            env.basicPassword!
        );
        if (!ok) {
            return { ok: false, status: 401, error: "unauthorized" };
        }
    } else if (requireAuth) {
        return { ok: false, status: 503, error: "auth_not_configured" };
    }

    const sig = (input.signatureHeader ?? "").trim();
    if (env.hmacSecret && sig) {
        const hmacOk = verifyPagarmeWebhookHmacSignature(
            input.rawBody,
            input.signatureHeader,
            env.hmacSecret
        );
        if (!hmacOk) {
            return { ok: false, status: 401, error: "invalid_signature" };
        }
    }

    return { ok: true };
}
