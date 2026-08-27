import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { cancelBroadcastCampaign } from "@/lib/campaigns/enqueueCampaign";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
    const access = await requireCompanyAccess(["owner", "admin"]);
    if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { admin, companyId } = access;
    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const { id } = await ctx.params;
    const { data, error } = await admin
        .from("broadcast_campaigns")
        .select(
            "id, name, status, audience_filter, total_recipients, sent_count, failed_count, skipped_count, started_at, finished_at, created_at, template_id"
        )
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { data: recipients } = await admin
        .from("broadcast_campaign_recipients")
        .select("id, phone_e164, status, error")
        .eq("campaign_id", id)
        .order("created_at", { ascending: true })
        .limit(200);

    return NextResponse.json({
        campaign: {
            id: data.id,
            name: data.name,
            status: data.status,
            totalRecipients: data.total_recipients,
            sentCount: data.sent_count,
            failedCount: data.failed_count,
            skippedCount: data.skipped_count,
            startedAt: data.started_at,
            finishedAt: data.finished_at,
        },
        recipients: recipients ?? [],
    });
}

export async function PATCH(req: Request, ctx: Ctx) {
    const access = await requireCompanyAccess(["owner", "admin"]);
    if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { admin, companyId } = access;
    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "cancel") {
        return NextResponse.json({ error: "action_required" }, { status: 400 });
    }

    const result = await cancelBroadcastCampaign({
        admin,
        companyId,
        campaignId: id,
    });
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
