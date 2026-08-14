import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    ApplyOrderFeeInput,
    OrderFeeLine,
    ServiceFeeDefinition,
    UpsertServiceFeePayload,
} from "@/src/taxas/domain/types";

export type TaxasCommandPort = {
    listDefinitions(
        admin: SupabaseClient,
        companyId: string,
        opts?: { activeOnly?: boolean }
    ): Promise<ServiceFeeDefinition[]>;
    upsertDefinition(
        admin: SupabaseClient,
        companyId: string,
        payload: UpsertServiceFeePayload
    ): Promise<string>;
    deactivateDefinition(
        admin: SupabaseClient,
        companyId: string,
        definitionId: string
    ): Promise<void>;
    listOrderFees(
        admin: SupabaseClient,
        companyId: string,
        orderId: string
    ): Promise<OrderFeeLine[]>;
    applyOrderFees(
        admin: SupabaseClient,
        companyId: string,
        orderId: string,
        fees: ApplyOrderFeeInput[]
    ): Promise<OrderFeeLine[]>;
};
