import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { setPlanPromotionActive } from "@/lib/platform/services/planPromotions";

export const runtime = "nodejs";

type Body = { active?: boolean };

/** PATCH — liga/desliga promo criada (kill-switch antes do fim da janela). */
export async function PATCH(
    req: Request,
    ctx: { params: Promise<{ id: string }> }
) {
    const { id } = await ctx.params;
    return withPlatformAccess("platform.billing.write", async (access) => {
        let body: Body;
        try {
            body = (await req.json()) as Body;
        } catch {
            return NextResponse.json({ error: "invalid_json" }, { status: 400 });
        }
        if (typeof body.active !== "boolean") {
            return NextResponse.json({ error: "active_required" }, { status: 400 });
        }
        try {
            const promotion = await setPlanPromotionActive(
                access.admin,
                id,
                body.active,
                toAuditCtx(access)
            );
            return NextResponse.json({ ok: true, promotion });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status = msg === "promo_id_required" ? 400 : 500;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
