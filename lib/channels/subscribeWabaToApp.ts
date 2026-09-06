import "server-only";

import { metaGraphPostJson } from "@/lib/whatsapp/metaGraphFetch";
import { metaGraphVersion, resolveMetaAppSecret } from "@/lib/meta/metaAppCredentials";
import { metaAppSecretProof } from "@/lib/channels/metaAppSecretProof";

export async function subscribeWabaToApp(params: {
    wabaId: string;
    accessToken: string;
}): Promise<void> {
    const wabaId = params.wabaId.trim();
    if (!wabaId) throw new Error("waba_id_required");

    const appSecret = resolveMetaAppSecret();
    const proof = appSecret ? metaAppSecretProof(params.accessToken, appSecret) : "";
    const q = proof ? `?appsecret_proof=${encodeURIComponent(proof)}` : "";
    const url = `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(wabaId)}/subscribed_apps${q}`;

    const result = await metaGraphPostJson(wabaId, url, {
        accessToken: params.accessToken,
        body: {},
    });
    if (!result.ok) {
        throw new Error("waba_subscribe_failed");
    }
}
