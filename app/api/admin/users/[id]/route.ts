import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    canChangeMemberRole,
    canDeactivateMember,
    canReactivateMember,
    canRemoveMember,
    normalizeCompanyRole,
    type CompanyRole,
} from "@/lib/workspace/staffRoles";
import { revokeAuthSessions } from "@/lib/workspace/inviteCompanyMember";

export const runtime = "nodejs";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: rawId } = await params;
    const membershipId = String(rawId ?? "").trim();
    if (!membershipId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role, userId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        role?: string;
        is_active?: boolean;
        profile_id?: string | null;
    };

    const patchKeys = [
        body.role !== undefined,
        body.is_active !== undefined,
        body.profile_id !== undefined,
    ].filter(Boolean);
    if (patchKeys.length === 0) {
        return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
    }

    const { data: target, error: tErr } = await admin
        .from("company_users")
        .select("id, user_id, role, is_active, profile_id")
        .eq("id", membershipId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (!target) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    const targetRole = normalizeCompanyRole(target.role);
    if (!targetRole) {
        return NextResponse.json({ error: "target_role_invalid" }, { status: 500 });
    }

    const isSelf = String(target.user_id) === userId;
    const actorRole = role as CompanyRole;
    const patch: Record<string, unknown> = {};

    let nextRole = targetRole;
    if (body.role !== undefined) {
        const nr = normalizeCompanyRole(body.role);
        if (!nr) return NextResponse.json({ error: "role_invalid" }, { status: 400 });
        if (
            !canChangeMemberRole({
                actorRole,
                targetRole,
                nextRole: nr,
                isSelf,
            })
        ) {
            return NextResponse.json({ error: "role_change_forbidden" }, { status: 403 });
        }
        nextRole = nr;
        patch.role = nr;
    }

    if (body.profile_id !== undefined || body.role !== undefined) {
        if (nextRole === "member") {
            const profileId =
                body.profile_id !== undefined
                    ? body.profile_id
                        ? String(body.profile_id)
                        : null
                    : target.profile_id
                      ? String(target.profile_id)
                      : null;
            if (!profileId) {
                return NextResponse.json({ error: "profile_required" }, { status: 400 });
            }
            const { data: profile } = await admin
                .from("company_staff_profiles")
                .select("id, is_active")
                .eq("id", profileId)
                .eq("company_id", companyId)
                .maybeSingle();
            if (!profile?.id || !profile.is_active) {
                return NextResponse.json({ error: "profile_invalid" }, { status: 400 });
            }
            patch.profile_id = profileId;
        } else {
            patch.profile_id = null;
        }
    }

    if (body.is_active !== undefined) {
        const nextActive = Boolean(body.is_active);
        if (nextActive === Boolean(target.is_active)) {
            // no-op
        } else if (!nextActive) {
            if (!canDeactivateMember({ actorRole, targetRole, isSelf })) {
                return NextResponse.json({ error: "deactivate_forbidden" }, { status: 403 });
            }
            patch.is_active = false;
        } else {
            if (!canReactivateMember({ actorRole, targetRole })) {
                return NextResponse.json({ error: "reactivate_forbidden" }, { status: 403 });
            }
            patch.is_active = true;
        }
    }

    if (Object.keys(patch).length === 0) {
        return NextResponse.json({ ok: true, id: membershipId });
    }

    const { error: upErr } = await admin
        .from("company_users")
        .update(patch)
        .eq("id", membershipId)
        .eq("company_id", companyId);

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    if (patch.is_active === false) {
        await revokeAuthSessions(admin, String(target.user_id));
    }

    return NextResponse.json({ ok: true, id: membershipId });
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: rawId } = await params;
    const membershipId = String(rawId ?? "").trim();
    if (!membershipId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role, userId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const { data: target, error: tErr } = await admin
        .from("company_users")
        .select("id, user_id, role")
        .eq("id", membershipId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (!target) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

    const targetRole = normalizeCompanyRole(target.role);
    if (!targetRole) {
        return NextResponse.json({ error: "target_role_invalid" }, { status: 500 });
    }

    const isSelf = String(target.user_id) === userId;
    if (
        !canRemoveMember({
            actorRole: role as CompanyRole,
            targetRole,
            isSelf,
        })
    ) {
        return NextResponse.json({ error: "remove_forbidden" }, { status: 403 });
    }

    const { error: delErr } = await admin
        .from("company_users")
        .delete()
        .eq("id", membershipId)
        .eq("company_id", companyId);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    await revokeAuthSessions(admin, String(target.user_id));
    return NextResponse.json({ ok: true });
}
