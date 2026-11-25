import { NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";
import { loadStorePaymentPolicy } from "@/lib/payments/loadStorePaymentPolicy";
import { assertStorePaymentAllowed } from "@/src/financeiro/domain/storePaymentPolicy";
import { isMesaPaymentMethod } from "@/src/mesa/domain/paymentParts";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { data, error } = await admin.rpc("rpc_mesa_list_queue", { p_company_id: companyId });
    if (error) return mesaRpcError(error, "queue_failed");
    return NextResponse.json(data ?? { ok: true, queue: [] });
}

type PartBody = { amount?: number; method?: string };

export async function POST(req: Request) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const body = (await req.json().catch(() => ({}))) as {
        sessionId?: string;
        cash_register_id?: string;
        parts?: PartBody[];
        seller_name?: string | null;
    };
    const sessionId = String(body.sessionId ?? "").trim();
    const cashRegisterId = String(body.cash_register_id ?? "").trim();
    if (!sessionId) return NextResponse.json({ error: "session_id_required" }, { status: 400 });
    if (!cashRegisterId) return NextResponse.json({ error: "cash_register_required" }, { status: 400 });

    let parts: Array<{ amount: number; method: string }> | undefined;
    if (Array.isArray(body.parts)) {
        const policy = await loadStorePaymentPolicy(admin, companyId);
        parts = [];
        for (const part of body.parts) {
            const amount = Number(part.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return NextResponse.json({ error: "payment_amount_invalid" }, { status: 400 });
            }
            const pay = assertStorePaymentAllowed(policy.immediate, policy.prazo, part.method ?? "");
            if (!pay.ok || !isMesaPaymentMethod(pay.method)) {
                return NextResponse.json({ error: "payment_not_allowed" }, { status: 400 });
            }
            parts.push({ amount, method: pay.method });
        }
    }

    const { data, error } = await admin.rpc("rpc_mesa_confirm_payment", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_payload: {
            cash_register_id: cashRegisterId,
            seller_name: body.seller_name ?? null,
            ...(parts ? { parts } : {}),
        },
    });
    if (error) return mesaRpcError(error, "confirm_failed");
    return NextResponse.json(data ?? { ok: true });
}
