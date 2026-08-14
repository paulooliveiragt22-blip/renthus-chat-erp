import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type { RecognizeOrderSaleInput } from "@/src/financeiro/ports/financeCommand.port";

export function recognizeOrderSale(admin: SupabaseClient, input: RecognizeOrderSaleInput) {
    return financeCommandSupabase.recognizeOrderSale(admin, input);
}
