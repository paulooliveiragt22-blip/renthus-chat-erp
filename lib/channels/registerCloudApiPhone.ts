import "server-only";

import { metaGraphPostJson } from "@/lib/whatsapp/metaGraphFetch";
import { metaGraphVersion, resolveMetaAppSecret } from "@/lib/meta/metaAppCredentials";
import { metaAppSecretProof } from "@/lib/channels/metaAppSecretProof";

const DEFAULT_PIN = "000000";

function isAlreadyRegistered(json: Record<string, unknown>): boolean {
    const err = json.error;
    if (!err || typeof err !== "object") return false;
    const rec = err as { code?: number; message?: string; error_subcode?: number };
    if (rec.code === 133010) return true;
    return /already registered/i.test(rec.message ?? "");
}

/**
 * Registra o número na Cloud API (caminho puro). Coexistence **não** deve chamar.
 * PIN 000000 se o lojista não definiu 2FA no fluxo.
 */
export async function registerCloudApiPhone(params: {
    phoneNumberId: string;
    accessToken: string;
    pin?: string;
}): Promise<void> {
    const phoneNumberId = params.phoneNumberId.trim();
    if (!phoneNumberId) throw new Error("phone_number_id_required");
    const pin = (params.pin ?? DEFAULT_PIN).trim() || DEFAULT_PIN;

    const appSecret = resolveMetaAppSecret();
    const proof = appSecret ? metaAppSecretProof(params.accessToken, appSecret) : "";
    const q = proof ? `?appsecret_proof=${encodeURIComponent(proof)}` : "";
    const url = `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(phoneNumberId)}/register${q}`;

    const result = await metaGraphPostJson(phoneNumberId, url, {
        accessToken: params.accessToken,
        body: { messaging_product: "whatsapp", pin },
    });
    if (result.ok || isAlreadyRegistered(result.json)) return;
    throw new Error("phone_register_failed");
}
