import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { checkPlatformIpAllowlist } from "./checkPlatformIpAllowlist";
import { checkPlatformMfa } from "./checkPlatformMfa";
import {
    platformRoleHasPermission,
    type PlatformPermission,
} from "./platformPermissions";
import { normalizePlatformRole, type PlatformRole } from "./platformRoles";
import { getPlatformRequestContext } from "./requestContext";

export type PlatformActor = {
    id: string;
    authUserId: string;
    email: string;
    displayName: string;
    role: PlatformRole;
    mfaRequired: boolean;
};

export type PlatformAccessContext = {
    ok: true;
    actor: PlatformActor;
    admin: ReturnType<typeof createAdminClient>;
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};

export type PlatformAccessDenied = {
    ok: false;
    status: number;
    error: string;
    code?: string;
};

export async function requirePlatformAccess(
    permission?: PlatformPermission,
    opts?: { skipMfa?: boolean; requestIdHeader?: string | null }
): Promise<PlatformAccessContext | PlatformAccessDenied> {
    const reqCtx = await getPlatformRequestContext(opts?.requestIdHeader);

    const h = await headers();
    const ipCheck = checkPlatformIpAllowlist(h);
    if (!ipCheck.ok) {
        return { ok: false, status: 403, error: "IP not allowed", code: ipCheck.reason };
    }

    const supabase = await createServerClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    const admin = createAdminClient();
    const { data: platformUser, error: puErr } = await admin
        .from("platform_users")
        .select("id, auth_user_id, email, display_name, role, is_active, mfa_required")
        .eq("auth_user_id", userData.user.id)
        .maybeSingle();

    if (puErr) {
        return { ok: false, status: 500, error: puErr.message };
    }
    if (!platformUser || !platformUser.is_active) {
        return { ok: false, status: 403, error: "Not a platform user" };
    }

    const role = normalizePlatformRole(platformUser.role);
    if (!role) {
        return { ok: false, status: 403, error: "Invalid platform role" };
    }

    if (!opts?.skipMfa) {
        const mfa = await checkPlatformMfa(
            supabase,
            role,
            Boolean(platformUser.mfa_required)
        );
        if (!mfa.ok) {
            return {
                ok: false,
                status: 403,
                error: "MFA required",
                code: "mfa_required",
            };
        }
    }

    if (permission && !platformRoleHasPermission(role, permission)) {
        return { ok: false, status: 403, error: "Insufficient permission" };
    }

    const actor: PlatformActor = {
        id: platformUser.id,
        authUserId: platformUser.auth_user_id,
        email: platformUser.email,
        displayName: platformUser.display_name,
        role,
        mfaRequired: Boolean(platformUser.mfa_required),
    };

    await admin
        .from("platform_users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", actor.id);

    return {
        ok: true,
        actor,
        admin,
        requestId: reqCtx.requestId,
        ipAddress: reqCtx.ipAddress,
        userAgent: reqCtx.userAgent,
    };
}

export function platformAccessJson(
    denied: PlatformAccessDenied
): { error: string; code?: string } {
    return denied.code
        ? { error: denied.error, code: denied.code }
        : { error: denied.error };
}
