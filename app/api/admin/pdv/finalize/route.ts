import { NextResponse } from "next/server";
import {
    requireCompanyAnyPlanFeature,
    PDV_ACCESS_FEATURES,
    requirePlanFeature,
} from "@/lib/billing/requirePlanFeature";
import { checkRateLimit } from "@/lib/security/rateLimit";
import {
    applyFinalizePdvOrder,
    type FinalizePdvPayload,
} from "@/lib/offline/application/applyFinalizePdvOrder";

export const runtime = "nodejs";

const PDV_FINALIZE_RATE_LIMIT = 30;
const PDV_FINALIZE_RATE_WINDOW_MS = 60_000;

const PRAZO_METHODS = new Set(["credit", "boleto", "cheque", "promissoria"]);

function isPrazo(method: string): boolean {
    return PRAZO_METHODS.has(String(method).toLowerCase());
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAnyPlanFeature(
        [...PDV_ACCESS_FEATURES],
        ["owner", "admin", "member"],
        "pdv.access"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const rl = checkRateLimit(
        `pdv_finalize:${companyId}`,
        PDV_FINALIZE_RATE_LIMIT,
        PDV_FINALIZE_RATE_WINDOW_MS
    );
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    const body = (await req.json().catch(() => ({}))) as FinalizePdvPayload;

    const payments = Array.isArray(body.payments) ? body.payments : [];
    const hasCreditPayment = payments.some((p) => isPrazo(p.method));
    if (hasCreditPayment) {
        const prazoFeat = await requirePlanFeature(admin, companyId, "pdv");
        if (!prazoFeat.ok) return prazoFeat.response;
    }

    const wantsPrint = body.auto_print === true;
    if (wantsPrint) {
        const printFeat = await requirePlanFeature(admin, companyId, "printing_auto");
        if (!printFeat.ok) return printFeat.response;
    }

    const result = await applyFinalizePdvOrder({
        admin,
        companyId,
        body,
        enforceStockPolicy: true,
    });

    if (!result.ok) {
        const status = result.conflict ? 409 : 400;
        return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
        ok: true,
        sale_id: result.sale_id,
        order_id: result.order_id,
    });
}
