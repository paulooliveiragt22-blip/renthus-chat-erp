import type { SupabaseClient } from "@supabase/supabase-js";
import { roleRequiresMfa, type PlatformRole } from "./platformRoles";

export type MfaCheckResult =
    | { ok: true; aal: string | null; needsEnroll: false }
    | {
          ok: false;
          error: "mfa_required";
          aal: string | null;
          /** Sem fator TOTP verificado — UI deve enroll antes do challenge */
          needsEnroll: boolean;
      };

export function platformUserNeedsMfa(
    role: PlatformRole,
    mfaRequiredFlag: boolean
): boolean {
    return mfaRequiredFlag || roleRequiresMfa(role);
}

/**
 * Para roles que exigem MFA (superadmin/ops ou flag): só passa com JWT aal2.
 * Sem fator cadastrado / só aal1 → bloqueia (não “libera por ausência de enroll”).
 */
export async function checkPlatformMfa(
    supabase: SupabaseClient,
    role: PlatformRole,
    mfaRequiredFlag: boolean
): Promise<MfaCheckResult> {
    if (!platformUserNeedsMfa(role, mfaRequiredFlag)) {
        return { ok: true, aal: null, needsEnroll: false };
    }

    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
        return { ok: false, error: "mfa_required", aal: null, needsEnroll: true };
    }

    const current = data.currentLevel;
    const next = data.nextLevel;

    if (current === "aal2") {
        return { ok: true, aal: current, needsEnroll: false };
    }

    // nextLevel aal2 = há fator verificado; falta só o challenge nesta sessão
    const needsEnroll = next !== "aal2";
    return {
        ok: false,
        error: "mfa_required",
        aal: current ?? null,
        needsEnroll,
    };
}

export function readAalFromSession(session: { access_token?: string } | null): string | null {
    if (!session?.access_token) return null;
    try {
        const payload = session.access_token.split(".")[1];
        if (!payload) return null;
        const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
            aal?: string;
        };
        return typeof json.aal === "string" ? json.aal : null;
    } catch {
        return null;
    }
}
