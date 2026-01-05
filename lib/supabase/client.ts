import { createBrowserSupabaseClient } from "@/src/lib/supabaseClient";

export function createClient() {
    return createBrowserSupabaseClient();
}
