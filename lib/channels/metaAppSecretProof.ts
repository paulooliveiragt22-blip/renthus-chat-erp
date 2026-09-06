import { createHmac } from "node:crypto";

/** HMAC-SHA256(token, app_secret) — Graph `appsecret_proof`. */
export function metaAppSecretProof(accessToken: string, appSecret: string): string {
    return createHmac("sha256", appSecret).update(accessToken, "utf8").digest("hex");
}
