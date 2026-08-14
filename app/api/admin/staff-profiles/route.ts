import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { ensureDefaultStaffProfiles } from "@/lib/workspace/rbac/ensureDefaultStaffProfiles";
import {
    CAPABILITY_GROUPS,
    normalizeCapabilities,
    type CapabilityKey,
} from "@/lib/workspace/rbac/capabilities";
import {
    isProfileTemplateKey,
    templateLabel,
    type ProfileTemplateKey,
} from "@/lib/workspace/rbac/profileTemplates";

export const runtime = "nodejs";

type ProfileRow = {
    id: string;
    name: string;
    template_key: string;
    capabilities: string[] | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

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

    const { data, error } = await admin
        .from("company_staff_profiles")
        .select("id, name, template_key, capabilities, is_active, created_at, updated_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        profiles: (data ?? []) as ProfileRow[],
        catalog: CAPABILITY_GROUPS,
        template_labels: {
            cashier: templateLabel("cashier"),
            kitchen: templateLabel("kitchen"),
            driver: templateLabel("driver"),
            waiter: templateLabel("waiter"),
            custom: templateLabel("custom"),
        },
    });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "staff_users");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        template_key?: string;
        capabilities?: unknown;
    };

    const name = String(body.name ?? "").trim();
    if (!name || name.length > 80) {
        return NextResponse.json({ error: "name_invalid" }, { status: 400 });
    }

    let templateKey: ProfileTemplateKey = "custom";
    if (body.template_key !== undefined) {
        if (!isProfileTemplateKey(body.template_key)) {
            return NextResponse.json({ error: "template_invalid" }, { status: 400 });
        }
        templateKey = body.template_key;
    }

    // Templates de sistema: só um por empresa — se já existe, use PATCH.
    if (templateKey !== "custom") {
        const { data: exists } = await admin
            .from("company_staff_profiles")
            .select("id")
            .eq("company_id", companyId)
            .eq("template_key", templateKey)
            .maybeSingle();
        if (exists?.id) {
            return NextResponse.json(
                { error: "template_already_exists", id: exists.id },
                { status: 409 }
            );
        }
    }

    const capabilities = normalizeCapabilities(body.capabilities) as CapabilityKey[];

    const { data, error } = await admin
        .from("company_staff_profiles")
        .insert({
            company_id: companyId,
            name,
            template_key: templateKey,
            capabilities,
            is_active: true,
        })
        .select("id, name, template_key, capabilities, is_active, created_at, updated_at")
        .single();

    if (error) {
        if (String(error.message).includes("company_staff_profiles_company_name_uq")) {
            return NextResponse.json({ error: "name_duplicate" }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, profile: data });
}
