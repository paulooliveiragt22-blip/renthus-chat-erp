/**
 * lib/chatbot/db/company.ts
 *
 * Funções de acesso à tabela de empresas (companies).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getCompanyInfo(
    admin: SupabaseClient,
    companyId: string
): Promise<{ name: string; settings: Record<string, unknown> } | null> {
    const { data } = await admin
        .from("companies")
        .select("name, settings")
        .eq("id", companyId)
        .maybeSingle();

    return data
        ? { name: data.name ?? "nossa loja", settings: (data.settings as Record<string, unknown>) ?? {} }
        : null;
}
