import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential } from "@/lib/security/credentialCrypto";
import type { MessagingChannel } from "@/src/domain/contracts/identity";

export type MetaMessagingChannelRow = {
    id: string;
    company_id: string;
    page_id: string;
    page_name: string | null;
    ig_user_id: string | null;
    encrypted_page_access_token: string | null;
    status: string;
    messenger_enabled: boolean;
    instagram_enabled: boolean;
    provider_metadata: Record<string, unknown>;
};

export type PublicMetaMessagingConnection = {
    id: string;
    pageId: string;
    pageName: string | null;
    igUserId: string | null;
    status: string;
    messengerEnabled: boolean;
    instagramEnabled: boolean;
    hasAccessToken: boolean;
};

export function toPublicMetaConnection(row: MetaMessagingChannelRow): PublicMetaMessagingConnection {
    return {
        id: row.id,
        pageId: row.page_id,
        pageName: row.page_name,
        igUserId: row.ig_user_id,
        status: row.status,
        messengerEnabled: row.messenger_enabled,
        instagramEnabled: row.instagram_enabled,
        hasAccessToken: Boolean(row.encrypted_page_access_token?.trim()),
    };
}

export function resolvePageAccessToken(row: {
    encrypted_page_access_token?: string | null;
    provider_metadata?: unknown;
}): string {
    if (row.encrypted_page_access_token) {
        const dec = decryptCredential(row.encrypted_page_access_token);
        if (dec) return dec;
    }
    const isProd =
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    if (isProd) return "";
    const pm = (row.provider_metadata as { page_access_token?: string } | null) ?? {};
    if (typeof pm.page_access_token === "string") return pm.page_access_token;
    return process.env.META_PAGE_ACCESS_TOKEN?.trim() ?? "";
}

export async function loadActiveMetaChannelByPageId(
    admin: SupabaseClient,
    pageId: string
): Promise<MetaMessagingChannelRow | null> {
    const { data, error } = await admin
        .from("meta_messaging_channels")
        .select(
            "id, company_id, page_id, page_name, ig_user_id, encrypted_page_access_token, status, messenger_enabled, instagram_enabled, provider_metadata"
        )
        .eq("page_id", pageId)
        .eq("status", "active")
        .maybeSingle();
    if (error || !data) return null;
    return data as MetaMessagingChannelRow;
}

export async function loadActiveMetaChannelByIgUserId(
    admin: SupabaseClient,
    igUserId: string
): Promise<MetaMessagingChannelRow | null> {
    const { data, error } = await admin
        .from("meta_messaging_channels")
        .select(
            "id, company_id, page_id, page_name, ig_user_id, encrypted_page_access_token, status, messenger_enabled, instagram_enabled, provider_metadata"
        )
        .eq("ig_user_id", igUserId)
        .eq("status", "active")
        .maybeSingle();
    if (error || !data) return null;
    return data as MetaMessagingChannelRow;
}

export async function loadActiveMetaChannelByCompany(
    admin: SupabaseClient,
    companyId: string
): Promise<MetaMessagingChannelRow | null> {
    const { data, error } = await admin
        .from("meta_messaging_channels")
        .select(
            "id, company_id, page_id, page_name, ig_user_id, encrypted_page_access_token, status, messenger_enabled, instagram_enabled, provider_metadata"
        )
        .eq("company_id", companyId)
        .eq("status", "active")
        .maybeSingle();
    if (error || !data) return null;
    return data as MetaMessagingChannelRow;
}

export function encryptPageAccessToken(plain: string): string | null {
    return encryptCredential(plain);
}

export function channelEnabledFor(
    row: MetaMessagingChannelRow,
    channel: Extract<MessagingChannel, "instagram" | "messenger">
): boolean {
    if (channel === "instagram") return row.instagram_enabled;
    return row.messenger_enabled;
}
