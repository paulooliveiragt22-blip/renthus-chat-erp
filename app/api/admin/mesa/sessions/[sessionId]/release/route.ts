import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";
import { loadStorePaymentPolicy } from "@/lib/payments/loadStorePaymentPolicy";
import { assertStorePaymentAllowed } from "@/src/financeiro/domain/storePaymentPolicy";
import { isMesaPaymentMethod } from "@/src/mesa/domain/paymentParts";

export const runtime = "nodejs";

type PartBody = { amount?: number; method?: string };

export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;
    const body = (await req.json().catch(() => ({}))) as { parts?: PartBody[] };
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (parts.length === 0) {
        return NextResponse.json({ error: "payments_required" }, { status: 400 });
    }

    const policy = await loadStorePaymentPolicy(admin, companyId);
    const normalized = [];
    for (const part of parts) {
        const amount = Number(part.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return NextResponse.json({ error: "payment_amount_invalid" }, { status: 400 });
        }
        const pay = assertStorePaymentAllowed(policy.immediate, policy.prazo, part.method ?? "");
        if (!pay.ok || !isMesaPaymentMethod(pay.method)) {
            return NextResponse.json({ error: "payment_not_allowed" }, { status: 400 });
        }
        normalized.push({ amount, method: pay.method });
    }

    const { data, error } = await admin.rpc("rpc_mesa_release_table", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_payload: { parts: normalized },
    });
    if (error) return mesaRpcError(error, "release_failed");
    return NextResponse.json(data ?? { ok: true });
}
