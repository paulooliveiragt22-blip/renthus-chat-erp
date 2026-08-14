import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { postOpex } from "@/src/financeiro/application/postOpex";
import {
    enforceFinanceWriteRateLimit,
    financeRpcFailure,
} from "@/src/financeiro/application/http";

export const runtime = "nodejs";

/**
 * POST /api/admin/financeiro/opex
 * Cria payable (e journal 4.2) via rpc_post_opex. Chave do client obrigatória na UI.
 */
export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin", "member"],
        "financeiro.write"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const limited = enforceFinanceWriteRateLimit(companyId, "opex");
    if (limited) return limited;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const amount = Number.parseFloat(String(body.amount ?? "").replaceAll(",", "."));
    const due_date = String(body.due_date ?? "").trim();
    if (!due_date || Number.isNaN(amount) || amount <= 0) {
        return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    const payment_status = String(body.payment_status ?? "pending");
    const idempotencyKey = String(body.idempotency_key ?? "").trim();
    if (!idempotencyKey) {
        return NextResponse.json({ error: "idempotency_key_required" }, { status: 400 });
    }

    try {
        await postOpex(admin, {
            companyId,
            payload: {
                category: String(body.category ?? body.description ?? "outros"),
                description: String(body.notes ?? body.description ?? ""),
                amount,
                due_date,
                payment_status,
                payment_method: String(body.payment_method ?? "pix"),
                idempotency_key: idempotencyKey,
            },
        });
    } catch (err) {
        return financeRpcFailure(err instanceof Error ? err.message : "opex_failed");
    }
    return NextResponse.json({ ok: true });
}
