import { NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";
import { postCashMovement } from "@/src/financeiro/application/postCashMovement";
import { financeRpcFailure } from "@/src/financeiro/application/http";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyAnyPlanFeature(
        [...PDV_ACCESS_FEATURES],
        ["owner", "admin", "member"],
        "pdv.access"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const rl = checkRateLimit(`pdv_cash_mov:${companyId}`, 30, 60_000);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    const body = (await req.json().catch(() => ({}))) as {
        cash_register_id?: string;
        type?: "sangria" | "suprimento";
        amount?: number;
        reason?: string | null;
        operator_name?: string | null;
        idempotency_key?: string;
    };

    const cashRegisterId = String(body.cash_register_id ?? "").trim();
    if (!cashRegisterId) return NextResponse.json({ error: "cash_register_id_required" }, { status: 400 });
    if (!body.type || (body.type !== "sangria" && body.type !== "suprimento")) {
        return NextResponse.json({ error: "type_invalid" }, { status: 400 });
    }

    const idempotencyKey = String(body.idempotency_key ?? "").trim();
    if (!idempotencyKey) {
        return NextResponse.json({ error: "idempotency_key_required" }, { status: 400 });
    }

    try {
        await postCashMovement(admin, {
            companyId,
            registerId: cashRegisterId,
            type: body.type,
            amount: Number(body.amount ?? 0),
            reason: body.reason?.trim() || null,
            operatorName: body.operator_name?.trim() || null,
            idempotencyKey,
        });
    } catch (err) {
        return financeRpcFailure(err instanceof Error ? err.message : "cash_movement_failed");
    }
    return NextResponse.json({ ok: true });
}
