import "server-only";

import { metaGraphPostJson } from "@/lib/whatsapp/metaGraphFetch";
import { metaGraphVersion, resolveMetaAppSecret } from "@/lib/meta/metaAppCredentials";
import { metaAppSecretProof } from "@/lib/channels/metaAppSecretProof";

const SYNC_TYPES = ["smb_app_state_sync", "history"] as const;

/**
 * Dispara sync de contatos + histórico (janela 24h da Meta). Best-effort.
 */
export async function startCoexistenceDataSync(params: {
    phoneNumberId: string;
    accessToken: string;
}): Promise<{ ok: boolean; failed: string[] }> {
    const phoneNumberId = params.phoneNumberId.trim();
    if (!phoneNumberId) return { ok: false, failed: ["phone_number_id_required"] };

    const appSecret = resolveMetaAppSecret();
    const proof = appSecret ? metaAppSecretProof(params.accessToken, appSecret) : "";
    const q = proof ? `?appsecret_proof=${encodeURIComponent(proof)}` : "";
    const url = `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(phoneNumberId)}/smb_app_data${q}`;

    const results = await Promise.allSettled(
        SYNC_TYPES.map((syncType) =>
            metaGraphPostJson(phoneNumberId, url, {
                accessToken: params.accessToken,
                body: { messaging_product: "whatsapp", sync_type: syncType },
            })
        )
    );

    const failed: string[] = [];
    results.forEach((r, i) => {
        const type = SYNC_TYPES[i] ?? "unknown";
        if (r.status === "rejected") {
            failed.push(type);
            return;
        }
        if (!r.value.ok) failed.push(type);
    });

    if (failed.length) {
        console.warn("[embedded-signup] smb_app_data partial fail", { failed });
    }
    return { ok: failed.length === 0, failed };
}
