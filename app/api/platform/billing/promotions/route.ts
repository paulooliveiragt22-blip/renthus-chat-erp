import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    listPlanPromotions,
    upsertPlanPromotion,
} from "@/lib/platform/services/planPromotions";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.billing.read", async (access) => {
        try {
            const promotions = await listPlanPromotions(access.admin);
            return NextResponse.json({ promotions });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return NextResponse.json({ error: msg }, { status: 500 });
        }
    });
}

export async function POST(req: Request) {
    return withPlatformAccess("platform.billing.write", async (access) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return NextResponse.json({ error: "invalid_json" }, { status: 400 });
        }

        try {
            const promo = await upsertPlanPromotion(
                access.admin,
                {
                    plan_id: String(body.plan_id ?? ""),
                    name: typeof body.name === "string" ? body.name : "",
                    starts_at: String(body.starts_at ?? ""),
                    ends_at: String(body.ends_at ?? ""),
                    duration_months: Number(body.duration_months),
                    adjustment_kind: body.adjustment_kind as "discount" | "surcharge",
                    adjustment_mode: body.adjustment_mode as "fixed_brl" | "percent",
                    adjustment_value: Number(body.adjustment_value),
                    active: body.active !== false,
                },
                toAuditCtx(access),
                typeof body.id === "string" ? body.id : undefined
            );
            return NextResponse.json({ ok: true, promotion: promo });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status = msg.endsWith("_invalid") || msg.endsWith("_required") ? 400 : 500;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
