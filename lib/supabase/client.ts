import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

/**
 * Returns a singleton instance of the Supabase client for client-side usage.
 *
 * Some parts of the app still call `getSupabase()`. Creating this alias keeps
 * that code working while avoiding multiple client instantiations.
 */
export function getSupabase() {
    if (!cachedClient) {
        cachedClient = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
    }

    return cachedClient;
}

export function createClient() {
    return getSupabase();
}
