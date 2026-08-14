import type { SupabaseClient } from "@supabase/supabase-js";
import { taxasSupabase } from "@/src/taxas/adapters/supabase/taxas.supabase";
import type {
    ApplyOrderFeeInput,
    UpsertServiceFeePayload,
} from "@/src/taxas/domain/types";

export async function listServiceFeeDefinitions(
    admin: SupabaseClient,
    companyId: string,
    activeOnly = false
) {
    return taxasSupabase.listDefinitions(admin, companyId, { activeOnly });
}

export async function upsertServiceFeeDefinition(
    admin: SupabaseClient,
    companyId: string,
    payload: UpsertServiceFeePayload
) {
    return taxasSupabase.upsertDefinition(admin, companyId, payload);
}

export async function deactivateServiceFeeDefinition(
    admin: SupabaseClient,
    companyId: string,
    definitionId: string
) {
    return taxasSupabase.deactivateDefinition(admin, companyId, definitionId);
}

export async function listOrderFees(
    admin: SupabaseClient,
    companyId: string,
    orderId: string
) {
    return taxasSupabase.listOrderFees(admin, companyId, orderId);
}

export async function applyOrderFees(
    admin: SupabaseClient,
    companyId: string,
    orderId: string,
    fees: ApplyOrderFeeInput[]
) {
    return taxasSupabase.applyOrderFees(admin, companyId, orderId, fees);
}
