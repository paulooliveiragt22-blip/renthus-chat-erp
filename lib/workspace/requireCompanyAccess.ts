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
import { finalizeExpiredImpersonationSession } from "@/lib/platform/finalizeExpiredImpersonation";
import {
    requireBillingActive,
    type BillingAccessStatus,
    type BillingGateMode,
} from "@/lib/billing/requireBillingActive";

export type RequireCompanyAccessOptions = {
    allowedRoles?: string[];
    /** default "full"; billing routes usam "billing_self"; impersonation força "skip" */
    billing?: BillingGateMode;
    /**
     * A3: POST/PATCH/DELETE sob impersonation → 403.
     * Preferir passar true em mutações; o proxy também bloqueia via isTenantMutationPath.
     */
    mutating?: boolean;
};

type AccessOk = {
    ok: true;
    companyId: string;
    userId: string;
    role: string;
    admin: ReturnType<typeof createAdminClient>;
    impersonating: boolean;
    impersonationSessionId?: string;
    billingStatus?: BillingAccessStatus;
};

type AccessDenied = {
    ok: false;
    status: number;
    error: string;
    code?: string;
    billingStatus?: BillingAccessStatus;
};

function normalizeOpts(
    allowedRolesOrOpts?: string[] | RequireCompanyAccessOptions
): RequireCompanyAccessOptions {
    if (!allowedRolesOrOpts) return {};
    if (Array.isArray(allowedRolesOrOpts)) {
        return { allowedRoles: allowedRolesOrOpts };
    }
    return allowedRolesOrOpts;
}

export async function requireCompanyAccess(
    allowedRolesOrOpts?: string[] | RequireCompanyAccessOptions
): Promise<AccessOk | AccessDenied> {
    const opts = normalizeOpts(allowedRolesOrOpts);
    const allowedRoles = opts.allowedRoles;

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
        if (row && !isImpersonationActive(row)) {
            await finalizeExpiredImpersonationSession(admin, row);
        } else if (isImpersonationActive(row) && row!.company_id === companyId) {
            const { data: platformUser } = await admin
                .from("platform_users")
                .select("id, auth_user_id, is_active")
                .eq("id", row!.platform_user_id)
                .eq("auth_user_id", userData.user.id)
                .eq("is_active", true)
                .maybeSingle();

            if (platformUser) {
                if (opts.mutating) {
                    return {
                        ok: false as const,
                        status: 403,
                        error: "Modo suporte é somente leitura. Mutações bloqueadas.",
                        code: "impersonation_read_only",
                    };
                }
                return {
                    ok: true as const,
                    companyId,
                    userId: userData.user.id,
                    role: "admin",
                    admin,
                    impersonating: true as const,
                    impersonationSessionId: row!.id,
                    billingStatus: "active",
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

    const billingMode: BillingGateMode = opts.billing ?? "full";
    const billing = await requireBillingActive(admin, companyId, billingMode);
    if (!billing.ok) {
        return {
            ok: false as const,
            status: billing.status,
            error: billing.error,
            code: billing.code,
            billingStatus: billing.billingStatus,
        };
    }

    return {
        ok: true as const,
        companyId,
        userId: userData.user.id,
        role,
        admin,
        impersonating: false as const,
        billingStatus: billing.status,
    };
}
