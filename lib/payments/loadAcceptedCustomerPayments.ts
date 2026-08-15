import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    acceptedCustomerPaymentsFromCompanySettings,
    type AcceptedCustomerPayments,
} from "@/src/financeiro/domain/acceptedCustomerPayments";

export async function loadAcceptedCustomerPayments(
    admin: SupabaseClient,
    companyId: string
): Promise<AcceptedCustomerPayments> {
    const { data } = await admin
        .from("companies")
        .select("settings")
        .eq("id", companyId)
        .maybeSingle();
    return acceptedCustomerPaymentsFromCompanySettings(data?.settings);
}
