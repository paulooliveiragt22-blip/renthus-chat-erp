import crypto from "node:crypto";

/** Prefixo + base64(iv 12B | tag 16B | ciphertext). */
const TOKEN_PREFIX = "wa1:";

const KEY_BYTES = 32;

function getEncryptionKey(): Buffer | null {
    const raw = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();
    if (!raw) return null;
    try {
        const buf = Buffer.from(raw, "base64");
        return buf.length === KEY_BYTES ? buf : null;
    } catch {
        return null;
    }
}

/** Cifra access token Meta para gravar em `whatsapp_channels.encrypted_access_token`. */
export function encryptWaAccessToken(plain: string): string | null {
    const key = getEncryptionKey();
    if (!key || !plain) return null;
    const iv     = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc    = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return TOKEN_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptWaAccessToken(stored: string | null | undefined): string | null {
    if (!stored?.startsWith(TOKEN_PREFIX)) return null;
    const key = getEncryptionKey();
    if (!key) return null;
    try {
        const raw        = Buffer.from(stored.slice(TOKEN_PREFIX.length), "base64");
        const iv         = raw.subarray(0, 12);
        const tag        = raw.subarray(12, 28);
        const ciphertext = raw.subarray(28);
        const decipher   = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}

export type WhatsappChannelSecretRow = {
    from_identifier?:       string | null;
    provider_metadata?:     unknown;
    encrypted_access_token?: string | null;
    waba_id?:               string | null;
};

export function resolveChannelAccessToken(row: WhatsappChannelSecretRow): string {
    if (row.encrypted_access_token) {
        const dec = decryptWaAccessToken(row.encrypted_access_token);
        if (dec) return dec;
    }
    const pm = (row.provider_metadata as { access_token?: string } | null) ?? {};
    if (pm.access_token) return pm.access_token;
    return process.env.WHATSAPP_TOKEN ?? "";
}

export function resolveChannelWabaId(row: WhatsappChannelSecretRow): string {
    const col = (row.waba_id ?? "").trim();
    if (col) return col;
    const pm = (row.provider_metadata as { waba_id?: string } | null) ?? {};
    return (pm.waba_id ?? "").trim();
}

export function stripProviderMetadataSecrets(
    meta: Record<string, unknown> | null | undefined
): Record<string, unknown> {
    if (!meta) return {};
    const rest = { ...meta };
    delete rest.access_token;
    delete rest.waba_id;
    return rest;
}

export type PublicWhatsappChannel = {
    id:                  string;
    company_id?:         string;
    from_identifier:     string;
    status:              string;
    provider_metadata:   Record<string, unknown>;
    waba_id:             string;
    created_at?:         string;
    hasAccessToken:      boolean;
};

/** Remove segredos antes de enviar ao cliente (superadmin UI). */
export function sanitizeWhatsappChannelForClient(row: {
    id: string;
    company_id?: string;
    from_identifier: string;
    status: string;
    provider_metadata?: unknown;
    encrypted_access_token?: string | null;
    waba_id?: string | null;
    created_at?: string;
}): PublicWhatsappChannel {
    const pm = (row.provider_metadata ?? {}) as Record<string, unknown>;
    const hasAccessToken = Boolean(row.encrypted_access_token?.trim())
        || (typeof pm.access_token === "string" && pm.access_token.length > 0);
    const wabaCol = (row.waba_id ?? "").trim();
    const wabaMeta = typeof pm.waba_id === "string" ? pm.waba_id.trim() : "";
    return {
        id:                row.id,
        company_id:        row.company_id,
        from_identifier:   row.from_identifier,
        status:            row.status,
        provider_metadata: stripProviderMetadataSecrets(pm),
        waba_id:           wabaCol || wabaMeta,
        created_at:        row.created_at,
        hasAccessToken,
    };
}
