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
import { ensureDefaultStaffProfiles } from "@/lib/workspace/rbac/ensureDefaultStaffProfiles";

export const runtime = "nodejs";

type MemberRow = {
    id: string;
    user_id: string;
    role: string;
    is_active: boolean;
    created_at: string;
    profile_id: string | null;
};

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    try {
        await ensureDefaultStaffProfiles(admin, companyId);
    } catch (e) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "seed_failed" },
            { status: 500 }
        );
    }

    const [{ data, error }, { data: profiles }] = await Promise.all([
        admin
            .from("company_users")
            .select("id, user_id, role, is_active, created_at, profile_id")
            .eq("company_id", companyId)
            .order("created_at", { ascending: true }),
        admin
            .from("company_staff_profiles")
            .select("id, name, template_key, is_active")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("name", { ascending: true }),
    ]);

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
                role: normalizeCompanyRole(row.role) ?? row.role,
                is_active: row.is_active,
                created_at: row.created_at,
                profile_id: row.profile_id,
                email,
            };
        })
    );

    return NextResponse.json({
        members,
        profiles: profiles ?? [],
        inviteable_roles: inviteableRolesFor(role as CompanyRole),
    });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        email?: string;
        role?: string;
        profile_id?: string | null;
    };
    const email = String(body.email ?? "").trim().toLowerCase();
    const targetRole = normalizeCompanyRole(body.role);
    if (!email) return NextResponse.json({ error: "email_required" }, { status: 400 });
    if (!targetRole || targetRole === "owner") {
        return NextResponse.json({ error: "role_invalid" }, { status: 400 });
    }
    if (!canInviteRole(role as CompanyRole, targetRole)) {
        return NextResponse.json({ error: "role_not_allowed" }, { status: 403 });
    }

    // R3-3 / BN-17: capacidade = seat_quantity; sem cobrir seat_add ainda → bloqueia no cap.
    const [{ count: activeCount }, { data: subRow }] = await Promise.all([
        admin
            .from("company_users")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .eq("is_active", true),
        admin
            .from("pagarme_subscriptions")
            .select("seat_quantity, plan")
            .eq("company_id", companyId)
            .maybeSingle(),
    ]);
    const { loadPlanPricing } = await import("@/lib/billing/loadPlanPricing");
    const pricing = await loadPlanPricing(admin, String(subRow?.plan ?? "essencial"));
    const capacity =
        typeof subRow?.seat_quantity === "number" && subRow.seat_quantity >= 1
            ? subRow.seat_quantity
            : pricing.includedSeats;
    if ((activeCount ?? 0) >= capacity) {
        return NextResponse.json(
            {
                error: "seat_limit_reached",
                message:
                    pricing.seatExtraCents == null
                        ? "Plano Essencial permite 1 usuário. Faça upgrade para adicionar equipe."
                        : "Limite de usuários atingido. Compre um seat adicional (em breve no checkout) ou aumente a capacidade.",
                seat_quantity: capacity,
                active_users: activeCount ?? 0,
                seat_extra_cents: pricing.seatExtraCents,
            },
            { status: 402 }
        );
    }

    const result = await inviteCompanyMember({
        admin,
        companyId,
        email,
        role: targetRole,
        profileId: targetRole === "member" ? body.profile_id : null,
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
