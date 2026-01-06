/**
 * lib/supabase/client.ts
 * Supabase client helpers (browser)
 * - createClient() -> fábrica (retorna um novo client)
 * - getSupabase() -> lazy singleton para uso em components cliente
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

let _cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_cachedClient) return _cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set these env vars in .env.local or Vercel."
    );
  }

  _cachedClient = createBrowserClient(url, anonKey);
  return _cachedClient;
}
