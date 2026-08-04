import "server-only";

import crypto from "node:crypto";

/** Prefixo + base64(iv 12B | tag 16B | ciphertext) — genérico para tokens marketplace. */
const TOKEN_PREFIX = "mp1:";
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

export function encryptCredential(plain: string): string | null {
    const key = getEncryptionKey();
    if (!key || !plain) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return TOKEN_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptCredential(stored: string | null | undefined): string | null {
    if (!stored?.startsWith(TOKEN_PREFIX)) return null;
    const key = getEncryptionKey();
    if (!key) return null;
    try {
        const raw = Buffer.from(stored.slice(TOKEN_PREFIX.length), "base64");
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const ciphertext = raw.subarray(28);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}
