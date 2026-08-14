import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    canChangeMemberRole,
    canDeactivateMember,
    canReactivateMember,
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
    };

    const patchKeys = [
        body.role !== undefined,
        body.is_active !== undefined,
    ].filter(Boolean);
    if (patchKeys.length === 0) {
        return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
    }
    // Enxugar: só role e is_active
    if (patchKeys.length > 2) {
        return NextResponse.json({ error: "campos_nao_permitidos" }, { status: 400 });
    }

    const { data: target, error: tErr } = await admin
        .from("company_users")
        .select("id, user_id, role, is_active")
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

    if (body.role !== undefined) {
        const nextRole = normalizeCompanyRole(body.role);
        if (!nextRole) return NextResponse.json({ error: "role_invalid" }, { status: 400 });
        if (
            !canChangeMemberRole({
                actorRole,
                targetRole,
                nextRole,
                isSelf,
            })
        ) {
            return NextResponse.json({ error: "role_change_forbidden" }, { status: 403 });
        }
        patch.role = nextRole;
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
