import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRole } from "@/lib/workspace/staffRoles";

function appBaseUrl(): string {
    const raw =
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        process.env.VERCEL_URL?.trim() ||
        "http://localhost:3000";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
    return `https://${raw.replace(/\/$/, "")}`;
}

/**
 * Garante usuário Auth + membership em company_users.
 * Compensa: se membership falhar após criar usuário novo, remove o auth user.
 */
export async function inviteCompanyMember(params: {
    admin: SupabaseClient;
    companyId: string;
    email: string;
    role: Exclude<CompanyRole, "owner">;
}): Promise<
    | { ok: true; userId: string; membershipId: string; invited: boolean }
    | { ok: false; error: string; status: number }
> {
    const email = params.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
        return { ok: false, error: "e-mail inválido", status: 400 };
    }

    const { data: existingId, error: findErr } = await params.admin.rpc(
        "rpc_find_auth_user_id_by_email",
        { p_email: email }
    );
    if (findErr) {
        return { ok: false, error: findErr.message, status: 500 };
    }

    let userId = existingId ? String(existingId) : "";
    let createdAuthUser = false;
    let invited = false;

    if (!userId) {
        const redirectTo = `${appBaseUrl()}/login`;
        const { data: invitedUser, error: invErr } = await params.admin.auth.admin.inviteUserByEmail(
            email,
            {
                redirectTo,
                data: { invited_company_id: params.companyId },
            }
        );
        if (invErr || !invitedUser?.user?.id) {
            return {
                ok: false,
                error: invErr?.message ?? "falha ao enviar convite",
                status: 500,
            };
        }
        userId = invitedUser.user.id;
        createdAuthUser = true;
        invited = true;
    }

    const { data: existingMembership } = await params.admin
        .from("company_users")
        .select("id, role, is_active")
        .eq("company_id", params.companyId)
        .eq("user_id", userId)
        .maybeSingle();

    if (existingMembership?.id) {
        if (String(existingMembership.role) === "owner") {
            return { ok: false, error: "usuário já é proprietário desta empresa", status: 409 };
        }
        const { data: updated, error: upErr } = await params.admin
            .from("company_users")
            .update({ role: params.role, is_active: true })
            .eq("id", existingMembership.id)
            .eq("company_id", params.companyId)
            .select("id")
            .single();
        if (upErr || !updated?.id) {
            return { ok: false, error: upErr?.message ?? "falha ao atualizar membro", status: 500 };
        }
        return { ok: true, userId, membershipId: String(updated.id), invited: false };
    }

    const { data: inserted, error: insErr } = await params.admin
        .from("company_users")
        .insert({
            company_id: params.companyId,
            user_id: userId,
            role: params.role,
            is_active: true,
        })
        .select("id")
        .single();

    if (insErr || !inserted?.id) {
        if (createdAuthUser) {
            try {
                await params.admin.auth.admin.deleteUser(userId);
            } catch (err) {
                console.warn(
                    "[inviteCompanyMember] compensação deleteUser:",
                    err instanceof Error ? err.message : err
                );
            }
        }
        return { ok: false, error: insErr?.message ?? "falha ao vincular usuário", status: 500 };
    }

    return {
        ok: true,
        userId,
        membershipId: String(inserted.id),
        invited,
    };
}

export async function revokeAuthSessions(admin: SupabaseClient, userId: string): Promise<void> {
    try {
        // supabase-js: encerra sessões do usuário (best-effort)
        const authAdmin = admin.auth.admin as {
            signOut?: (id: string, scope?: string) => Promise<{ error: Error | null }>;
        };
        if (typeof authAdmin.signOut === "function") {
            await authAdmin.signOut(userId, "global");
            return;
        }
    } catch (err) {
        console.warn("[revokeAuthSessions]", err instanceof Error ? err.message : err);
    }
}
