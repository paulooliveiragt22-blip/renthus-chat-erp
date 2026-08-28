import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannel } from "@/src/domain/contracts/identity";
import {
    isGenericCustomerDisplayName,
    normalizeCustomerDisplayName,
} from "@/lib/meta/customerDisplayName";

/**
 * Nome exibível do cliente no cardápio (thread Meta → customer).
 * Ignora placeholders genéricos.
 */
export async function resolveChannelDisplayNameForMenu(
    admin: SupabaseClient,
    companyId: string,
    channel: MessagingChannel,
    externalId: string,
    customerName?: string | null
): Promise<string | null> {
    const fromCustomer = normalizeCustomerDisplayName(customerName);
    if (fromCustomer && !isGenericCustomerDisplayName(fromCustomer)) {
        return fromCustomer;
    }

    const ext = externalId.trim();
    if (!ext || channel === "whatsapp" || channel === "web") {
        return fromCustomer || null;
    }

    const { data: thread } = await admin
        .from("whatsapp_threads")
        .select("profile_name")
        .eq("company_id", companyId)
        .eq("channel", channel)
        .eq("external_id", ext)
        .maybeSingle();

    const fromThread = normalizeCustomerDisplayName(
        (thread?.profile_name as string | null | undefined) ?? null
    );
    if (fromThread && !isGenericCustomerDisplayName(fromThread)) {
        return fromThread;
    }

    return null;
}
