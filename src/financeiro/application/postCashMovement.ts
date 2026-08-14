import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type { PostCashMovementInput } from "@/src/financeiro/ports/financeCommand.port";

export function postCashMovement(admin: SupabaseClient, input: PostCashMovementInput) {
    return financeCommandSupabase.postCashMovement(admin, input);
}
