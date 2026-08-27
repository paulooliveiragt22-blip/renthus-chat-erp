import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    loadActiveMetaChannelByCompany,
    resolvePageAccessToken,
} from "@/lib/meta/messagingChannels";
import { metaGraphGetJson } from "@/lib/whatsapp/metaGraphFetch";

const GRAPH_BASE =
    process.env.META_GRAPH_VERSION?.trim()
        ? `https://graph.facebook.com/${process.env.META_GRAPH_VERSION.trim()}`
        : process.env.WHATSAPP_BASE_URL?.replace(/\/$/, "") ||
          "https://graph.facebook.com/v20.0";

export type MetaPageHealthResult = {
    ok: boolean;
    checkedAt: string;
    errorCode?: string;
    errorMessage?: string;
    pageName?: string;
    igUserId?: string | null;
};

/**
 * Probe Graph GET /{page-id}?fields=name,instagram_business_account
 * e persiste last_health_* se as colunas existirem.
 */
export async function probeMetaPageHealth(
    admin: SupabaseClient,
    companyId: string
): Promise<MetaPageHealthResult> {
    const checkedAt = new Date().toISOString();
    const row = await loadActiveMetaChannelByCompany(admin, companyId);
    if (!row) {
        return {
            ok: false,
            checkedAt,
            errorCode: "no_active_channel",
            errorMessage: "Nenhuma Page Meta conectada.",
        };
    }

    const token = resolvePageAccessToken(row);
    if (!token) {
        const result: MetaPageHealthResult = {
            ok: false,
            checkedAt,
            errorCode: "missing_page_token",
            errorMessage: "Token da Page ausente.",
        };
        await persistMetaHealth(admin, row.id, result);
        return result;
    }

    const url =
        `${GRAPH_BASE}/${encodeURIComponent(row.page_id)}` +
        `?fields=name,instagram_business_account{id}`;
    const res = await metaGraphGetJson(row.page_id, url, { accessToken: token });

    if (!res.ok) {
        const errObj = res.json?.error as { message?: string; code?: number } | undefined;
        const result: MetaPageHealthResult = {
            ok: false,
            checkedAt,
            errorCode:
                res.status === 401 || errObj?.code === 190
                    ? "token_invalid"
                    : `graph_http_${res.status}`,
            errorMessage: errObj?.message ?? `HTTP ${res.status}`,
        };
        await persistMetaHealth(admin, row.id, result);
        return result;
    }

    const ig = res.json.instagram_business_account as { id?: string } | undefined;
    const result: MetaPageHealthResult = {
        ok: true,
        checkedAt,
        pageName: typeof res.json.name === "string" ? res.json.name : undefined,
        igUserId: ig?.id ?? row.ig_user_id,
    };
    await persistMetaHealth(admin, row.id, result);
    return result;
}

async function persistMetaHealth(
    admin: SupabaseClient,
    channelId: string,
    result: MetaPageHealthResult
): Promise<void> {
    // Colunas last_health_* podem não existir ainda em meta_messaging_channels —
    // tenta update; se falhar, só loga.
    const { error } = await admin
        .from("meta_messaging_channels")
        .update({
            last_health_at: result.checkedAt,
            last_health_ok: result.ok,
            last_health_error: result.ok
                ? null
                : `${result.errorCode ?? "error"}: ${result.errorMessage ?? ""}`.slice(
                      0,
                      500
                  ),
            ...(result.pageName ? { page_name: result.pageName } : {}),
            ...(result.igUserId ? { ig_user_id: result.igUserId } : {}),
            updated_at: result.checkedAt,
        })
        .eq("id", channelId);

    if (error) {
        console.warn("[meta/health] persist skipped:", error.message);
    }
}
