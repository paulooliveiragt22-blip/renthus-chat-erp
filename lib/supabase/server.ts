import "server-only";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/src/lib/supabaseClient";

export async function createClient() {
    const cookieStore = await cookies();

    return createServerSupabaseClient({
        getAll() {
            return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
            try {
                for (const { name, value, options } of cookiesToSet) {
                    cookieStore.set(name, value, options);
                }
            } catch {
                // Em Server Components, set pode falhar (sem response).
                // Se você chamar isso em Route Handler / Server Action, funciona.
            }
        },
    });
}
