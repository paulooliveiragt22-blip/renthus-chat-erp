import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    canInviteRole,
    inviteableRolesFor,
    normalizeCompanyRole,
    type CompanyRole,
} from "@/lib/workspace/staffRoles";
import { inviteCompanyMember } from "@/lib/workspace/inviteCompanyMember";

export const runtime = "nodejs";

type MemberRow = {
    id: string;
    user_id: string;
    role: string;
    is_active: boolean;
    created_at: string;
};

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const { data, error } = await admin
        .from("company_users")
        .select("id, user_id, role, is_active, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as MemberRow[];
    const members = await Promise.all(
        rows.map(async (row) => {
            let email: string | null = null;
            try {
                const { data: u } = await admin.auth.admin.getUserById(row.user_id);
                email = u.user?.email ?? null;
            } catch {
                email = null;
            }
            return {
                id: row.id,
                user_id: row.user_id,
                role: row.role,
                is_active: row.is_active,
                created_at: row.created_at,
                email,
            };
        })
    );

    return NextResponse.json({
        members,
        inviteable_roles: inviteableRolesFor(role as CompanyRole),
    });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const targetRole = normalizeCompanyRole(body.role);
    if (!email) return NextResponse.json({ error: "email_required" }, { status: 400 });
    if (!targetRole || targetRole === "owner") {
        return NextResponse.json({ error: "role_invalid" }, { status: 400 });
    }
    if (!canInviteRole(role as CompanyRole, targetRole)) {
        return NextResponse.json({ error: "role_not_allowed" }, { status: 403 });
    }

    const result = await inviteCompanyMember({
        admin,
        companyId,
        email,
        role: targetRole,
    });
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
        ok: true,
        membership_id: result.membershipId,
        user_id: result.userId,
        invited: result.invited,
    });
}
