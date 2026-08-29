import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { ensureTenantCheckout } from "@/lib/platform/services/platformNeverPaidTenants";

export const runtime = "nodejs";

/**
 * POST /api/platform/tenants/[companyId]/ensure-checkout
 * Garante invoice pending + best-effort PIX (idempotente).
 */
export async function POST(
    _req: Request,
    ctxParams: { params: Promise<{ companyId: string }> }
) {
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        const { companyId } = await ctxParams.params;
        if (!companyId?.trim()) {
            return NextResponse.json({ error: "companyId required" }, { status: 400 });
        }

        try {
            const audit = toAuditCtx(ctx);
            const result = await ensureTenantCheckout(
                ctx.admin,
                ctx.actor,
                audit,
                companyId.trim()
            );
            return NextResponse.json({
                ok: true,
                company_id: companyId,
                invoice_id: result.invoiceId,
                pix_qr_code: result.pixCode,
                invoice_ready: Boolean(result.invoiceId),
                has_pix: Boolean(result.pixCode),
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const status =
                msg.includes("already_paid") || msg.includes("not_eligible") ? 409 : 400;
            return NextResponse.json({ error: msg }, { status });
        }
    });
}
