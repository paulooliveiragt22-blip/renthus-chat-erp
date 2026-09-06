import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPlatformAudit, newRequestId } from "@/lib/platform/audit/recordPlatformAudit";
import {
    isImpersonationExpired,
    type ImpersonationSessionRow,
} from "@/lib/platform/impersonation";
import type { PlatformActor } from "@/lib/platform/requirePlatformAccess";

/**
 * Se a sessão expirou e ainda não tem ended_at, fecha + audit `expired`.
 * Idempotente (CAS via ended_at IS NULL).
 */
export async function finalizeExpiredImpersonationSession(
    admin: SupabaseClient,
    row: ImpersonationSessionRow,
    opts?: { requestId?: string; ipAddress?: string | null; userAgent?: string | null }
): Promise<boolean> {
    if (!isImpersonationExpired(row)) return false;

    const endedAt = new Date().toISOString();
    const { data: updated } = await admin
        .from("platform_impersonation_sessions")
        .update({ ended_at: endedAt })
        .eq("id", row.id)
        .is("ended_at", null)
        .select("id")
        .maybeSingle();

    if (!updated) return false;

    const { data: pu } = await admin
        .from("platform_users")
        .select("id, email, role, auth_user_id, display_name, mfa_required")
        .eq("id", row.platform_user_id)
        .maybeSingle();

    const actor: PlatformActor | null = pu
        ? {
              id: String(pu.id),
              email: String(pu.email ?? ""),
              role: pu.role as PlatformActor["role"],
              authUserId: String(pu.auth_user_id ?? ""),
              displayName: String(pu.display_name ?? pu.email ?? ""),
              mfaRequired: Boolean(pu.mfa_required),
          }
        : null;

    await recordPlatformAudit({
        admin,
        actor,
        action: "platform.impersonation.expired",
        resourceType: "company",
        resourceId: row.company_id,
        companyId: row.company_id,
        requestId: newRequestId(opts?.requestId),
        ipAddress: opts?.ipAddress ?? null,
        userAgent: opts?.userAgent ?? null,
        metadata: {
            session_id: row.id,
            reason: row.reason,
            expires_at: row.expires_at,
        },
    });

    return true;
}
