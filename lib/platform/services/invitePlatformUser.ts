import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import {
    normalizePlatformRole,
    roleRequiresMfa,
    type PlatformRole,
} from "@/lib/platform/platformRoles";
import type { PlatformActor } from "@/lib/platform/requirePlatformAccess";

export type InvitePlatformUserAuditCtx = {
    actor: PlatformActor;
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};

function appBaseUrl(): string {
    const raw =
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        process.env.VERCEL_URL?.trim() ||
        "http://localhost:3000";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
    return `https://${raw.replace(/\/$/, "")}`;
}

/**
 * Convida operador platform: Auth invite + insert platform_users.
 * Compensa: se insert falhar após criar auth user novo, remove o auth user.
 */
export async function invitePlatformUser(params: {
    admin: SupabaseClient;
    email: string;
    displayName: string;
    role: PlatformRole;
    audit: InvitePlatformUserAuditCtx;
}): Promise<
    | { ok: true; platformUserId: string; authUserId: string; invited: boolean }
    | { ok: false; error: string; status: number }
> {
    const email = params.email.trim().toLowerCase();
    const displayName = params.displayName.trim();
    const role = normalizePlatformRole(params.role);

    if (!email || !email.includes("@")) {
        return { ok: false, error: "e-mail inválido", status: 400 };
    }
    if (!displayName || displayName.length < 2) {
        return { ok: false, error: "nome obrigatório", status: 400 };
    }
    if (!role) {
        return { ok: false, error: "role inválida", status: 400 };
    }

    const { data: existingPu } = await params.admin
        .from("platform_users")
        .select("id, email, is_active")
        .eq("email", email)
        .maybeSingle();
    if (existingPu?.id) {
        return { ok: false, error: "já existe usuário platform com este e-mail", status: 409 };
    }

    const { data: existingAuthId, error: findErr } = await params.admin.rpc(
        "rpc_find_auth_user_id_by_email",
        { p_email: email }
    );
    if (findErr) {
        return { ok: false, error: findErr.message, status: 500 };
    }

    let authUserId = existingAuthId ? String(existingAuthId) : "";
    let createdAuthUser = false;
    let invited = false;

    if (!authUserId) {
        const next =
            "/auth/set-password?next=" + encodeURIComponent("/platform/login");
        const redirectTo =
            `${appBaseUrl()}/auth/callback?next=` + encodeURIComponent(next);
        const { data: invitedUser, error: invErr } =
            await params.admin.auth.admin.inviteUserByEmail(email, {
                redirectTo,
                data: { platform_invite: true, display_name: displayName },
            });
        if (invErr || !invitedUser?.user?.id) {
            return {
                ok: false,
                error: invErr?.message ?? "falha ao enviar convite",
                status: 500,
            };
        }
        authUserId = invitedUser.user.id;
        createdAuthUser = true;
        invited = true;
    } else {
        const { data: alreadyPlatform } = await params.admin
            .from("platform_users")
            .select("id")
            .eq("auth_user_id", authUserId)
            .maybeSingle();
        if (alreadyPlatform?.id) {
            return {
                ok: false,
                error: "auth user já vinculado a platform_users",
                status: 409,
            };
        }
    }

    const { data: inserted, error: insErr } = await params.admin
        .from("platform_users")
        .insert({
            auth_user_id: authUserId,
            email,
            display_name: displayName,
            role,
            is_active: true,
            mfa_required: roleRequiresMfa(role),
        })
        .select("id, email, display_name, role, mfa_required")
        .single();

    if (insErr || !inserted?.id) {
        if (createdAuthUser) {
            await params.admin.auth.admin.deleteUser(authUserId).catch(() => {});
        }
        return {
            ok: false,
            error: insErr?.message ?? "falha ao criar platform_users",
            status: 500,
        };
    }

    await recordPlatformAudit({
        admin: params.admin,
        actor: params.audit.actor,
        action: "platform.user.created",
        resourceType: "platform_user",
        resourceId: inserted.id,
        requestId: params.audit.requestId,
        ipAddress: params.audit.ipAddress,
        userAgent: params.audit.userAgent,
        afterState: {
            email: inserted.email,
            display_name: inserted.display_name,
            role: inserted.role,
            mfa_required: inserted.mfa_required,
            invited,
        },
        metadata: { invited },
    });

    return {
        ok: true,
        platformUserId: inserted.id,
        authUserId,
        invited,
    };
}
