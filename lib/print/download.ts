// lib/print/download.ts
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Encripta / desencripta com AES-256-GCM usando chave de env DOWNLOAD_ENCRYPTION_KEY.
 * A chave deve ter 32 bytes (base64 ou hex). We'll assume base64.
 */

const ENC_KEY_BASE64 = process.env.DOWNLOAD_ENCRYPTION_KEY;
if (!ENC_KEY_BASE64) {
    // We don't throw here to allow for tests, but warn.
    console.warn("DOWNLOAD_ENCRYPTION_KEY is not set. Download encryption will fail if used.");
}

function getEncKey(): Buffer {
    if (!ENC_KEY_BASE64) throw new Error("DOWNLOAD_ENCRYPTION_KEY not configured");
    const key = Buffer.from(ENC_KEY_BASE64, "base64");
    if (key.length !== 32) throw new Error("DOWNLOAD_ENCRYPTION_KEY must decode to 32 bytes (base64)");
    return key;
}

export function encryptText(plaintext: string) {
    const key = getEncKey();
    const iv = crypto.randomBytes(12); // GCM recommended 12 bytes
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
    const tag = cipher.getAuthTag();
    // store iv + tag + encrypted in base64
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptText(payloadBase64: string) {
    const key = getEncKey();
    const buf = Buffer.from(payloadBase64, "base64");
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const encrypted = buf.slice(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return out.toString("utf8");
}

/** Gera apiKey aleatória e atualiza print_agents com hash. Retorna plain apiKey. */
export async function rotateApiKeyForAgent(agentId: string) {
    const admin = createAdminClient();
    const apiKey = crypto.randomBytes(24).toString("hex"); // 48 hex chars
    const prefix = apiKey.slice(0, 8);
    const hash = await bcrypt.hash(apiKey, 10);
    const { error } = await admin.from("print_agents").update({
        api_key_hash: hash,
        api_key_prefix: prefix,
        last_seen: new Date().toISOString()
    }).eq("id", agentId);
    if (error) throw error;
    return apiKey;
}

/** Gera token temporário (plainToken) e grava hash + encrypted_api_key */
export async function createDownloadToken({
    agentId,
    apiKeyPlain,
    createdBy,
    ttlMinutes = 15
}: {
    agentId: string,
    apiKeyPlain: string,
    createdBy?: string | null,
    ttlMinutes?: number
}) {
    const admin = createAdminClient();
    const token = crypto.randomBytes(18).toString("hex"); // 36 chars
    const prefix = token.slice(0, 8);
    const tokenHash = await bcrypt.hash(token, 10);
    const encryptedApiKey = encryptText(apiKeyPlain);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

    const { data, error } = await admin.from("agent_download_tokens").insert([{
        agent_id: agentId,
        token_hash: tokenHash,
        token_prefix: prefix,
        encrypted_api_key: encryptedApiKey,
        expires_at: expiresAt,
        created_by: createdBy || null
    }]).select().single();

    if (error) throw error;
    return { tokenPlain: token, tokenId: data.id, expiresAt };
}

/** Valida token (bcrypt compare) e retorna the DB row if valid */
export async function validateAndConsumeToken(agentId: string, tokenPlain: string) {
    const admin = createAdminClient();
    const prefix = tokenPlain.slice(0, 8);
    const { data: rows, error } = await admin.from("agent_download_tokens").select("*").eq("agent_id", agentId).eq("token_prefix", prefix).eq("used", false).lte("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(10);
    if (error) throw error;
    if (!rows || rows.length === 0) return null;

    // iterate candidate rows and bcrypt.compare
    for (const row of rows) {
        const ok = await bcrypt.compare(tokenPlain, row.token_hash);
        if (ok) {
            // found valid token
            // mark used (atomic-ish)
            const { error: updErr } = await admin.from("agent_download_tokens").update({ used: true, used_at: new Date().toISOString() }).eq("id", row.id);
            if (updErr) throw updErr;
            return row;
        }
    }
    return null;
}

/** Remove token and/or clear the encrypted_api_key after usage (defensive) */
export async function cleanupToken(id: string) {
    const admin = createAdminClient();
    await admin.from("agent_download_tokens").update({ encrypted_api_key: null }).eq("id", id);
}
