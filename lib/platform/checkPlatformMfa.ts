import type { SupabaseClient } from "@supabase/supabase-js";
import { roleRequiresMfa, type PlatformRole } from "./platformRoles";

export type MfaCheckResult =
    | { ok: true; aal: string | null }
    | { ok: false; error: "mfa_required"; aal: string | null };

export async function checkPlatformMfa(
    supabase: SupabaseClient,
    role: PlatformRole,
    mfaRequiredFlag: boolean
): Promise<MfaCheckResult> {
    const needsMfa = mfaRequiredFlag || roleRequiresMfa(role);
    if (!needsMfa) return { ok: true, aal: null };

    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
        return { ok: false, error: "mfa_required", aal: null };
    }

    const current = data.currentLevel;
    const next = data.nextLevel;

    if (current === "aal2") {
        return { ok: true, aal: current };
    }

    if (next === "aal2") {
        return { ok: false, error: "mfa_required", aal: current };
    }

    return { ok: true, aal: current };
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
