import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    hasCapability,
    type CapabilityKey,
} from "@/lib/workspace/rbac/capabilities";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { normalizeCompanyRole, type CompanyRole } from "@/lib/workspace/staffRoles";

export type CapabilityContext = {
    ok: true;
    companyId: string;
    userId: string;
    role: CompanyRole;
    admin: SupabaseClient;
    profileId: string | null;
    capabilities: CapabilityKey[];
};

async function loadMemberCapabilities(
    admin: SupabaseClient,
    companyId: string,
    profileId: string | null
): Promise<CapabilityKey[]> {
    if (!profileId) return [];
    const { data, error } = await admin
        .from("company_staff_profiles")
        .select("capabilities, is_active")
        .eq("id", profileId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (error || !data || !data.is_active) return [];
    const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
    return caps.filter((k): k is CapabilityKey => typeof k === "string") as CapabilityKey[];
}

/**
 * Owner/admin: acesso total às capabilities operacionais.
 * Member: precisa do perfil ativo com a capability pedida.
 */
export async function requireCapability(
    required: CapabilityKey | CapabilityKey[],
    mode: "any" | "all" = "any"
): Promise<CapabilityContext | { ok: false; status: number; error: string }> {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) return ctx;

    const role = normalizeCompanyRole(ctx.role);
    if (!role) {
        return { ok: false, status: 403, error: "Invalid role" };
    }

    if (role === "owner" || role === "admin") {
        return {
            ok: true,
            companyId: ctx.companyId,
            userId: ctx.userId,
            role,
            admin: ctx.admin,
            profileId: null,
            capabilities: [],
        };
    }

    const { data: membership, error } = await ctx.admin
        .from("company_users")
        .select("profile_id")
        .eq("company_id", ctx.companyId)
        .eq("user_id", ctx.userId)
        .maybeSingle();

    if (error) {
        return { ok: false, status: 500, error: error.message };
    }

    const profileId = membership?.profile_id ? String(membership.profile_id) : null;
    const capabilities = await loadMemberCapabilities(ctx.admin, ctx.companyId, profileId);

    if (!profileId) {
        return { ok: false, status: 403, error: "Perfil de acesso não atribuído" };
    }
    if (!hasCapability(capabilities, required, mode)) {
        return { ok: false, status: 403, error: "Insufficient capability" };
    }

    return {
        ok: true,
        companyId: ctx.companyId,
        userId: ctx.userId,
        role,
        admin: ctx.admin,
        profileId,
        capabilities,
    };
}
