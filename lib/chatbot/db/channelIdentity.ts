/**
 * Resolve / vincula cliente por identidade de canal (RPC).
 * Uso: bot WhatsApp/IG e cardápio web (token v2).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    ChannelIdentitySchema,
    type ChannelIdentity,
    type LinkPhoneResult,
    type ResolveIdentityResult,
    CustomerIdSchema,
} from "@/src/domain/contracts/identity";

export async function resolveOrCreateCustomerByIdentity(
    admin: SupabaseClient,
    params: {
        companyId: string;
        /** Aceita wire cru; validado/branded via Zod. */
        identity: ChannelIdentity | { channel: string; externalId: string };
        name?: string | null;
        origem?: string | null;
    }
): Promise<ResolveIdentityResult | null> {
    const identity = ChannelIdentitySchema.parse(params.identity);

    const { data, error } = await admin.rpc("resolve_or_create_customer_by_identity", {
        p_company_id: params.companyId,
        p_channel: identity.channel,
        p_external_id: identity.externalId,
        p_name: params.name ?? null,
        p_origem: params.origem ?? "chatbot",
    });

    if (error) {
        console.error("[channelIdentity] resolve:", error.message);
        return null;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.customer_id) return null;

    return {
        customerId: CustomerIdSchema.parse(String(row.customer_id)),
        isNew: Boolean(row.is_new),
        needsPhone: Boolean(row.needs_phone),
    };
}

export async function linkCustomerChannelPhone(
    admin: SupabaseClient,
    params: {
        companyId: string;
        customerId: string;
        phone: string;
        phoneE164?: string | null;
    }
): Promise<LinkPhoneResult | null> {
    const { data, error } = await admin.rpc("link_customer_channel_phone", {
        p_company_id: params.companyId,
        p_customer_id: params.customerId,
        p_phone: params.phone,
        p_phone_e164: params.phoneE164 ?? null,
    });

    if (error) {
        console.error("[channelIdentity] link phone:", error.message);
        return null;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.customer_id) return null;

    return {
        customerId: CustomerIdSchema.parse(String(row.customer_id)),
        merged: Boolean(row.merged),
        fromCustomerId: row.from_customer_id
            ? CustomerIdSchema.parse(String(row.from_customer_id))
            : null,
    };
}
