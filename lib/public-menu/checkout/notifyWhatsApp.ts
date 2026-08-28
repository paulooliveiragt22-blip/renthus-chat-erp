import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannel } from "@/src/domain/contracts/identity";
import {
    buildWebMenuOrderNotifyMessage,
    type WebMenuOrderNotifyInput,
} from "@/lib/orders/buildOrderNotifyMessage";
import { notifyCustomerChannel } from "@/lib/orders/notifyCustomerChannel";

/** Notifica o cliente após checkout do cardápio web (Meta se IG/Messenger, senão WhatsApp). */
export async function notifyWebMenuOrder(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string;
    phoneE164: string;
    originChannel?: MessagingChannel;
    originExternalId?: string;
} & WebMenuOrderNotifyInput): Promise<void> {
    const {
        admin,
        companyId,
        customerId,
        phoneE164,
        originChannel,
        originExternalId,
        ...messageInput
    } = params;

    const text = buildWebMenuOrderNotifyMessage(messageInput);
    const result = await notifyCustomerChannel({
        admin,
        companyId,
        customerId,
        phoneE164,
        text,
        originChannel,
        originExternalId,
    });

    if (!result.ok) {
        console.warn("[public-menu] order notify failed:", result.channel, result.error);
    }
}

/** @deprecated Use notifyWebMenuOrder */
export const notifyWebMenuOrderWhatsApp = notifyWebMenuOrder;
