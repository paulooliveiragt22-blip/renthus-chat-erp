import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { postOpex } from "@/src/financeiro/application/postOpex";
import {
    enforceFinanceWriteRateLimit,
    financeRpcFailure,
} from "@/src/financeiro/application/http";

export const runtime = "nodejs";

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
    if (!due_date || Number.isNaN(amount)) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

    const payment_status = String(body.payment_status ?? "pending");
    const idempotencyKey =
        String(body.idempotency_key ?? "").trim() ||
        `opex:${companyId}:${due_date}:${amount}:${String(body.category ?? "")}:${payment_status}`;

    try {
        await postOpex(admin, {
            companyId,
            payload: {
                category: String(body.category ?? ""),
                description: String(body.description ?? ""),
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

export async function DELETE() {
    return NextResponse.json(
        { error: "opex_delete_forbidden", hint: "Estorne o lançamento; não apague opex postado." },
        { status: 405 }
    );
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin", "member"],
        "financeiro.write"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const limited = enforceFinanceWriteRateLimit(companyId, "settle");
    if (limited) return limited;

    const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
    if (body.action !== "mark_paid") return NextResponse.json({ error: "invalid_action" }, { status: 400 });

    try {
        await postOpex(admin, {
            companyId,
            payload: { action: "mark_paid", id, idempotency_key: `bill:${id}:settle:paid` },
        });
    } catch (err) {
        return financeRpcFailure(err instanceof Error ? err.message : "opex_failed");
    }
    return NextResponse.json({ ok: true });
}
