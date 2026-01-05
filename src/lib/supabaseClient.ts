import { createBrowserClient, createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, supabasePublicEnv } from "./env";

export type SupabaseCookieAdapter = NonNullable<Parameters<typeof createSupabaseServerClient>[2]>["cookies"];

export function createBrowserSupabaseClient() {
    return createBrowserClient(supabasePublicEnv.url, supabasePublicEnv.anonKey);
}

export function createServerSupabaseClient(cookies: SupabaseCookieAdapter) {
    return createSupabaseServerClient(supabasePublicEnv.url, supabasePublicEnv.anonKey, { cookies });
}

export function createServiceSupabaseClient() {
    if (typeof window !== "undefined") {
        throw new Error("Service role client is only available on the server");
    }

    return createServiceClient(supabasePublicEnv.url, getSupabaseServiceRoleKey(), { auth: { persistSession: false } });
}
