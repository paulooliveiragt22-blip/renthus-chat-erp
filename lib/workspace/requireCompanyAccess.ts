import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { getCurrentCompanyIdFromCookie } from "./getCurrentCompanyId";
import { normalizeCompanyRole } from "./staffRoles";
import {
    PLATFORM_IMPERSONATION_COOKIE,
    isImpersonationActive,
    type ImpersonationSessionRow,
} from "@/lib/platform/impersonation";

export async function requireCompanyAccess(allowedRoles?: string[]) {
    const companyId = await getCurrentCompanyIdFromCookie();
    if (!companyId) {
        return { ok: false as const, status: 400, error: "No workspace selected" };
    }

    const supabase = await createServerClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
        return { ok: false as const, status: 401, error: "Unauthorized" };
    }

    const admin = createAdminClient();

    // Platform support impersonation (read-only at proxy layer for mutations)
    const jar = await cookies();
    const sessionId = jar.get(PLATFORM_IMPERSONATION_COOKIE)?.value;
    if (sessionId) {
        const { data: session } = await admin
            .from("platform_impersonation_sessions")
            .select("id, platform_user_id, company_id, reason, started_at, expires_at, ended_at")
            .eq("id", sessionId)
            .maybeSingle();

        const row = session as ImpersonationSessionRow | null;
        if (isImpersonationActive(row) && row!.company_id === companyId) {
            const { data: platformUser } = await admin
                .from("platform_users")
                .select("id, auth_user_id, is_active")
                .eq("id", row!.platform_user_id)
                .eq("auth_user_id", userData.user.id)
                .eq("is_active", true)
                .maybeSingle();

            if (platformUser) {
                return {
                    ok: true as const,
                    companyId,
                    userId: userData.user.id,
                    role: "admin",
                    admin,
                    impersonating: true as const,
                    impersonationSessionId: row!.id,
                };
            }
        }
    }

    const { data: membership } = await admin
        .from("company_users")
        .select("id, role, is_active")
        .eq("company_id", companyId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

    if (!membership || !membership.is_active) {
        return { ok: false as const, status: 403, error: "Forbidden" };
    }

    const role =
        normalizeCompanyRole(membership.role) ??
        String(membership.role || "").toLowerCase();

    if (allowedRoles && allowedRoles.length > 0) {
        const allowed = allowedRoles
            .map((r) => normalizeCompanyRole(r) ?? r.toLowerCase())
            .filter(Boolean);
        if (!allowed.includes(role)) {
            return { ok: false as const, status: 403, error: "Insufficient role" };
        }
    }

    return {
        ok: true as const,
        companyId,
        userId: userData.user.id,
        role,
        admin,
        impersonating: false as const,
    };
}
