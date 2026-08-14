import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { normalizeCapabilities } from "@/lib/workspace/rbac/capabilities";

export const runtime = "nodejs";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: rawId } = await params;
    const profileId = String(rawId ?? "").trim();
    if (!profileId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        capabilities?: unknown;
        is_active?: boolean;
    };

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name || name.length > 80) {
            return NextResponse.json({ error: "name_invalid" }, { status: 400 });
        }
        patch.name = name;
    }
    if (body.capabilities !== undefined) {
        patch.capabilities = normalizeCapabilities(body.capabilities);
    }
    if (body.is_active !== undefined) {
        patch.is_active = Boolean(body.is_active);
    }

    if (Object.keys(patch).length <= 1) {
        return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
    }

    const { data, error } = await admin
        .from("company_staff_profiles")
        .update(patch)
        .eq("id", profileId)
        .eq("company_id", companyId)
        .select("id, name, template_key, capabilities, is_active, created_at, updated_at")
        .maybeSingle();

    if (error) {
        if (String(error.message).includes("company_staff_profiles_company_name_uq")) {
            return NextResponse.json({ error: "name_duplicate" }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json({ ok: true, profile: data });
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: rawId } = await params;
    const profileId = String(rawId ?? "").trim();
    if (!profileId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const { count, error: cErr } = await admin
        .from("company_users")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("profile_id", profileId);

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if ((count ?? 0) > 0) {
        return NextResponse.json(
            { error: "profile_in_use", hint: "Reatribua os operadores antes de excluir o perfil." },
            { status: 409 }
        );
    }

    const { error } = await admin
        .from("company_staff_profiles")
        .delete()
        .eq("id", profileId)
        .eq("company_id", companyId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
