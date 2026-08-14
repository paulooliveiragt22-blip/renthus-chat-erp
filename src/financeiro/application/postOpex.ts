import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type { PostOpexInput } from "@/src/financeiro/ports/financeCommand.port";

export function postOpex(admin: SupabaseClient, input: PostOpexInput) {
    return financeCommandSupabase.postOpex(admin, input);
}
