import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderService } from "../../services/order/order.types";
import type { OrderServiceResult } from "@/src/types/contracts";
import { toLegacyDraft } from "@/src/types/contracts.adapters";
import { tryFinalizeAiOrderFromDraft } from "@/lib/chatbot/pro/finalizeAiOrder";

export class LegacyOrderServiceAdapter implements OrderService {
    constructor(private readonly admin: SupabaseClient) {}

    async createFromDraft(input: Parameters<OrderService["createFromDraft"]>[0]): Promise<OrderServiceResult> {
        const legacyDraft = toLegacyDraft(input.draft);
        const placed = await tryFinalizeAiOrderFromDraft({
            admin: this.admin,
            companyId: input.tenant.companyId,
            phoneE164: input.tenant.phoneE164,
            profileName: input.tenant.messageId ? null : null,
            draft: legacyDraft,
        });

        if (placed.ok) {
            return {
                ok: true,
                orderId: placed.orderId,
                customerMessage: placed.customerMessage,
                requireApproval: placed.requireApproval,
            };
        }

        return {
            ok: false,
            customerMessage: placed.customerMessage,
            errorCode: "RPC_ERROR",
            retryable: true,
        };
    }
}

