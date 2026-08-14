import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type { SettleBillInput } from "@/src/financeiro/ports/financeCommand.port";

export function settleBill(admin: SupabaseClient, input: SettleBillInput) {
    return financeCommandSupabase.settleBill(admin, input);
}
