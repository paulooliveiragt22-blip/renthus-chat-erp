import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraftPort, PrepareOrderDraftResult } from "@/src/pro/ports/orderDraft.port";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
    type PrepareTurnContext,
} from "@/src/pro/tools/prepareOrderDraft";
import type { PrepareDraftToolInput } from "@/src/types/contracts";

export class SupabaseOrderDraftAdapter implements OrderDraftPort {
    constructor(private readonly admin: SupabaseClient) {}

    prepareFromToolInput(params: {
        companyId: string;
        customerId: string | null;
        body: PrepareDraftToolInput;
        turn: PrepareTurnContext;
        catalogPolicy?: PrepareOrderDraftCatalogPolicy;
    }): Promise<PrepareOrderDraftResult> {
        return prepareOrderDraftFromTool(
            this.admin,
            params.companyId,
            params.customerId,
            params.body,
            params.turn,
            params.catalogPolicy ?? { kind: "unrestricted" }
        );
    }
}
