import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { previewCampaignAudience } from "@/lib/campaigns/buildAudience";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const url = new URL(req.url);
    const days = Number(url.searchParams.get("days") ?? "30");
    const marketing = url.searchParams.get("marketing") === "1";
    const filter =
        url.searchParams.get("mode") === "ordered_last_days"
            ? { mode: "ordered_last_days" as const, orderedLastDays: days }
            : { mode: "all_with_phone" as const };

    const result = await previewCampaignAudience(admin, companyId, filter, marketing);
    return NextResponse.json(result);
}
