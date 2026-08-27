import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    syncTemplatesFromMeta,
    toPublicTemplate,
} from "@/lib/whatsapp-templates/syncTemplatesFromMeta";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const { data, error } = await admin
        .from("whatsapp_message_templates")
        .select(
            "id, name, language, category, status, components, rejection_reason, meta_template_id, waba_id, last_synced_at"
        )
        .eq("company_id", companyId)
        .order("name", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        templates: (data ?? []).map(toPublicTemplate),
    });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "sync") {
        return NextResponse.json(
            { error: "action_required", hint: 'Use { "action": "sync" }' },
            { status: 400 }
        );
    }

    const result = await syncTemplatesFromMeta(admin, companyId);
    if (!result.ok) {
        return NextResponse.json(
            { error: result.error, hint: result.hint },
            { status: 502 }
        );
    }

    const { data, error } = await admin
        .from("whatsapp_message_templates")
        .select(
            "id, name, language, category, status, components, rejection_reason, meta_template_id, waba_id, last_synced_at"
        )
        .eq("company_id", companyId)
        .order("name", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        synced: result.synced,
        templates: (data ?? []).map(toPublicTemplate),
    });
}
