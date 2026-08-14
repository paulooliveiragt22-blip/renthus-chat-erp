import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PROFILE_SEEDS } from "@/lib/workspace/rbac/profileTemplates";

/**
 * Garante os 4 perfis padrão da empresa (idempotente).
 * Não cria "Outro" — esse nasce só quando o admin monta do zero / custom.
 */
export async function ensureDefaultStaffProfiles(
    admin: SupabaseClient,
    companyId: string
): Promise<void> {
    const { data: existing, error } = await admin
        .from("company_staff_profiles")
        .select("template_key")
        .eq("company_id", companyId)
        .neq("template_key", "custom");

    if (error) throw new Error(error.message);

    const have = new Set(
        (existing ?? []).map((r) => String((r as { template_key: string }).template_key))
    );

    const missing = DEFAULT_PROFILE_SEEDS.filter((s) => !have.has(s.template_key));
    if (missing.length === 0) return;

    const { error: insErr } = await admin.from("company_staff_profiles").insert(
        missing.map((s) => ({
            company_id: companyId,
            name: s.name,
            template_key: s.template_key,
            capabilities: s.capabilities,
            is_active: true,
        }))
    );
    if (insErr) throw new Error(insErr.message);
}
