import "server-only";

import { metaGraphGetJson } from "@/lib/whatsapp/metaGraphFetch";
import { metaGraphVersion, resolveMetaAppSecret } from "@/lib/meta/metaAppCredentials";
import { metaAppSecretProof } from "@/lib/channels/metaAppSecretProof";

export type WabaPhoneNumber = {
    phoneNumberId: string;
    displayPhone: string | null;
};

function graphUrl(path: string, accessToken: string): string {
    const appSecret = resolveMetaAppSecret();
    const proof = appSecret ? metaAppSecretProof(accessToken, appSecret) : "";
    const q = new URLSearchParams();
    if (proof) q.set("appsecret_proof", proof);
    const qs = q.toString();
    return `https://graph.facebook.com/${metaGraphVersion()}/${path}${qs ? `?${qs}` : ""}`;
}

export async function resolveWabaPhoneNumberId(params: {
    wabaId: string;
    accessToken: string;
    preferredPhoneNumberId?: string | null;
}): Promise<WabaPhoneNumber> {
    const wabaId = params.wabaId.trim();
    const preferred = params.preferredPhoneNumberId?.trim() ?? "";
    const url = graphUrl(
        `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number`,
        params.accessToken
    );
    const result = await metaGraphGetJson(wabaId, url, { accessToken: params.accessToken });
    const data = Array.isArray(result.json.data) ? result.json.data : [];
    type Row = { id?: string; display_phone_number?: string };
    const rows = data.filter((x): x is Row => Boolean(x) && typeof x === "object");

    const match =
        (preferred && rows.find((r) => String(r.id ?? "") === preferred)) || rows[0];
    const phoneNumberId = String(match?.id ?? "").trim();
    if (!result.ok || !phoneNumberId) {
        throw new Error("waba_phone_number_unresolved");
    }
    const display = String(match?.display_phone_number ?? "").trim();
    return { phoneNumberId, displayPhone: display || null };
}

export async function fetchPhoneCoexistenceFlags(params: {
    phoneNumberId: string;
    accessToken: string;
}): Promise<{ isOnBizApp: boolean; platformType: string | null }> {
    const phoneNumberId = params.phoneNumberId.trim();
    const url = graphUrl(
        `${encodeURIComponent(phoneNumberId)}?fields=is_on_biz_app,platform_type,display_phone_number`,
        params.accessToken
    );
    const result = await metaGraphGetJson(phoneNumberId, url, {
        accessToken: params.accessToken,
    });
    if (!result.ok) {
        return { isOnBizApp: false, platformType: null };
    }
    return {
        isOnBizApp: result.json.is_on_biz_app === true,
        platformType:
            typeof result.json.platform_type === "string"
                ? result.json.platform_type
                : null,
    };
}
