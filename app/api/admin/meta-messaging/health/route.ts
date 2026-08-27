import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { probeMetaPageHealth } from "@/lib/channels/probeMetaPageHealth";
import {
    loadActiveMetaChannelByCompany,
    toPublicMetaConnection,
} from "@/lib/meta/messagingChannels";

export const runtime = "nodejs";

export async function POST() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "omnichannel_ig_messenger");
    if (!feat.ok) return feat.response;

    const health = await probeMetaPageHealth(admin, companyId);
    const row = await loadActiveMetaChannelByCompany(admin, companyId);

    return NextResponse.json({
        health,
        connection: row ? toPublicMetaConnection(row) : null,
    });
}
