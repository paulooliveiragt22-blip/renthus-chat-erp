import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type { ReverseJournalInput } from "@/src/financeiro/ports/financeCommand.port";

export function reverseJournal(admin: SupabaseClient, input: ReverseJournalInput) {
    return financeCommandSupabase.reverseJournal(admin, input);
}
