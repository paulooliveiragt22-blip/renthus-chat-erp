import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    loadActiveWaChannelCreds,
} from "@/lib/whatsapp-templates/syncTemplatesFromMeta";
import { metaGraphGetJson } from "@/lib/whatsapp/metaGraphFetch";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";

const GRAPH_BASE =
    process.env.WHATSAPP_BASE_URL?.replace(/\/$/, "") ||
    "https://graph.facebook.com/v20.0";

export type ChannelHealthResult = {
    ok: boolean;
    checkedAt: string;
    errorCode?: string;
    errorMessage?: string;
    displayPhoneNumber?: string;
    verifiedName?: string;
};

function isProd(): boolean {
    return (
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
    );
}

/**
 * Probe Graph GET /{phone-number-id} e persiste last_health_* no canal.
 */
export async function probeWhatsappChannelHealth(
    admin: SupabaseClient,
    companyId: string
): Promise<ChannelHealthResult> {
    const checkedAt = new Date().toISOString();
    const creds = await loadActiveWaChannelCreds(admin, companyId);

    if ("error" in creds) {
        // loadActiveWaChannelCreds exige waba_id; health WA só precisa phone+token
        const { data: row } = await admin
            .from("whatsapp_channels")
            .select(
                "id, from_identifier, provider_metadata, encrypted_access_token, waba_id, status"
            )
            .eq("company_id", companyId)
            .eq("provider", "meta")
            .eq("status", "active")
            .maybeSingle();

        if (!row) {
            const result: ChannelHealthResult = {
                ok: false,
                checkedAt,
                errorCode: "no_active_channel",
                errorMessage: "Nenhum canal WhatsApp ativo.",
            };
            return result;
        }

        const token = resolveChannelAccessToken(row);
        const phoneNumberId = String(row.from_identifier ?? "").trim();
        if (!token || !phoneNumberId) {
            const result: ChannelHealthResult = {
                ok: false,
                checkedAt,
                errorCode: "missing_credentials",
                errorMessage: "Token ou Phone Number ID ausente.",
            };
            await persistHealth(admin, row.id, result);
            return result;
        }

        return probeAndPersist(admin, row.id, phoneNumberId, token, checkedAt);
    }

    return probeAndPersist(
        admin,
        creds.channelId,
        creds.phoneNumberId,
        creds.accessToken,
        checkedAt
    );
}

async function probeAndPersist(
    admin: SupabaseClient,
    channelId: string,
    phoneNumberId: string,
    accessToken: string,
    checkedAt: string
): Promise<ChannelHealthResult> {
    const url =
        `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}` +
        `?fields=display_phone_number,verified_name`;
    const res = await metaGraphGetJson(phoneNumberId, url, { accessToken });

    if (!res.ok) {
        const errObj = res.json?.error as { message?: string; code?: number } | undefined;
        const code =
            res.status === 401 || errObj?.code === 190
                ? "token_invalid"
                : `graph_http_${res.status}`;
        const result: ChannelHealthResult = {
            ok: false,
            checkedAt,
            errorCode: code,
            errorMessage: errObj?.message ?? `HTTP ${res.status}`,
        };
        await persistHealth(admin, channelId, result);
        return result;
    }

    const result: ChannelHealthResult = {
        ok: true,
        checkedAt,
        displayPhoneNumber:
            typeof res.json.display_phone_number === "string"
                ? res.json.display_phone_number
                : undefined,
        verifiedName:
            typeof res.json.verified_name === "string"
                ? res.json.verified_name
                : undefined,
    };
    await persistHealth(admin, channelId, result);
    return result;
}

async function persistHealth(
    admin: SupabaseClient,
    channelId: string,
    result: ChannelHealthResult
): Promise<void> {
    await admin
        .from("whatsapp_channels")
        .update({
            last_health_at: result.checkedAt,
            last_health_ok: result.ok,
            last_health_error: result.ok
                ? null
                : `${result.errorCode ?? "error"}: ${result.errorMessage ?? ""}`.slice(
                      0,
                      500
                  ),
        })
        .eq("id", channelId);
}

/** Em produção, não usar plaintext/env se o ciphertext falhar. */
export function shouldAllowPlaintextTokenFallback(): boolean {
    return !isProd();
}
