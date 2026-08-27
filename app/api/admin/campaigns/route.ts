import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    cancelBroadcastCampaign,
    startBroadcastCampaign,
} from "@/lib/campaigns/enqueueCampaign";
import type { AudienceFilter } from "@/lib/campaigns/buildAudience";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const { data, error } = await admin
        .from("broadcast_campaigns")
        .select(
            "id, name, status, audience_filter, total_recipients, sent_count, failed_count, skipped_count, started_at, finished_at, created_at, template_id, whatsapp_message_templates(name, category, language, status)"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        campaigns: (data ?? []).map((c) => {
            const tpl = c.whatsapp_message_templates as
                | { name?: string; category?: string; language?: string; status?: string }
                | { name?: string; category?: string; language?: string; status?: string }[]
                | null;
            const t = Array.isArray(tpl) ? tpl[0] : tpl;
            return {
                id: c.id,
                name: c.name,
                status: c.status,
                audienceFilter: c.audience_filter,
                totalRecipients: c.total_recipients,
                sentCount: c.sent_count,
                failedCount: c.failed_count,
                skippedCount: c.skipped_count,
                startedAt: c.started_at,
                finishedAt: c.finished_at,
                createdAt: c.created_at,
                templateId: c.template_id,
                templateName: t?.name ?? null,
                templateCategory: t?.category ?? null,
                templateLanguage: t?.language ?? null,
            };
        }),
    });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, userId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        templateId?: string;
        audienceMode?: "all_with_phone" | "ordered_last_days";
        orderedLastDays?: number;
        bodyParams?: string[];
    };

    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
    if (!templateId) {
        return NextResponse.json({ error: "template_id_required" }, { status: 400 });
    }

    const audience: AudienceFilter = {
        mode: body.audienceMode === "ordered_last_days" ? "ordered_last_days" : "all_with_phone",
        orderedLastDays: body.orderedLastDays,
    };

    const result = await startBroadcastCampaign({
        admin,
        companyId,
        userId,
        name: typeof body.name === "string" ? body.name : "Campanha",
        templateId,
        audience,
        bodyParams: Array.isArray(body.bodyParams)
            ? body.bodyParams.map((p) => String(p))
            : undefined,
    });

    if (!result.ok) {
        return NextResponse.json(
            { error: result.error, hint: result.hint },
            { status: 400 }
        );
    }

    return NextResponse.json({
        campaignId: result.campaignId,
        queued: result.queued,
    });
}
