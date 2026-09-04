/**
 * POST /api/billing/set-period
 *
 * Troca month|year ANTES do 1º pagamento (never-paid). Amount canônico
 * recalculado no banco via rpc_create_billing_obligation.
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { jsonAccessError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "billing_self",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const body = (await req.json().catch(() => ({}))) as { period?: string };
        const period = String(body.period ?? "").toLowerCase() === "year" ? "year" : "month";

        const { admin, companyId } = ctx;
        const { data: flipped, error: flipErr } = await admin.rpc(
            "rpc_set_prepay_billing_period",
            { p_company_id: companyId, p_period: period }
        );
        if (flipErr) {
            const msg = flipErr.message;
            const status =
                msg.includes("already_paid") ||
                msg.includes("subscription_not_eligible") ||
                msg.includes("period_invalid")
                    ? 409
                    : msg.includes("subscription_not_found")
                      ? 404
                      : 400;
            return NextResponse.json({ error: msg }, { status });
        }

        const { data: oblig, error: obligErr } = await admin.rpc(
            "rpc_create_billing_obligation",
            { p_company_id: companyId, p_kind: "subscription", p_seat_qty: null }
        );
        if (obligErr) {
            return NextResponse.json({ error: obligErr.message }, { status: 500 });
        }

        const o = (oblig ?? {}) as {
            kind?: string;
            amount_cents?: number;
            invoice_id?: string;
        };

        return NextResponse.json({
            ok: true,
            billing_period: period,
            flip: flipped,
            invoice_id: o.invoice_id ?? null,
            kind: o.kind ?? (period === "year" ? "year" : "subscription"),
            amount_cents: Number(o.amount_cents ?? 0),
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
