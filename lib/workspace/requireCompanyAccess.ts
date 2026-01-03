import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getCurrentCompanyIdFromCookie } from "./getCurrentCompanyId";

export async function requireCompanyAccess(allowedRoles?: string[]) {
    const companyId = getCurrentCompanyIdFromCookie();
    if (!companyId) {
        return { ok: false as const, status: 400, error: "No workspace selected" };
    }

    const supabase = await createServerClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
        return { ok: false as const, status: 401, error: "Unauthorized" };
    }

    const admin = createAdminClient();
    const { data: membership } = await admin
        .from("company_users")
        .select("id, role, is_active")
        .eq("company_id", companyId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

    if (!membership || !membership.is_active) {
        return { ok: false as const, status: 403, error: "Forbidden" };
    }

    const role = String(membership.role || "").toLowerCase();

    if (allowedRoles && allowedRoles.length > 0) {
        const allowed = allowedRoles.map((r) => r.toLowerCase());
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
    };
}
