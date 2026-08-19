import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    storePaymentsFromCompanySettings,
    type AcceptedStorePayments,
    type AcceptedStorePrazo,
} from "@/src/financeiro/domain/storePaymentPolicy";

export async function loadStorePaymentPolicy(
    admin: SupabaseClient,
    companyId: string
): Promise<{ immediate: AcceptedStorePayments; prazo: AcceptedStorePrazo }> {
    const { data } = await admin
        .from("companies")
        .select("settings")
        .eq("id", companyId)
        .maybeSingle();
    return storePaymentsFromCompanySettings(data?.settings);
}
