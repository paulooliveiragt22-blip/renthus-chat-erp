// lib/supabase/admin.ts
import "server-only";
import { createServiceSupabaseClient } from "@/src/lib/supabaseClient";

export function createAdminClient() {
    return createServiceSupabaseClient();
}
