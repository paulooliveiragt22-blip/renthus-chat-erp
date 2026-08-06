import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

/** Abre sessão em uma mesa. */
export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        tableId?: string;
        notes?: string | null;
        customerId?: string | null;
    };
    const tableId = String(body.tableId ?? "").trim();
    if (!tableId) return NextResponse.json({ error: "table_id_required" }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_mesa_open_session", {
        p_company_id: companyId,
        p_table_id: tableId,
        p_notes: body.notes ?? null,
        p_customer_id: body.customerId ?? null,
    });
    if (error) {
        const msg = error.message || "open_failed";
        const status =
            msg.includes("already_open") || msg.includes("disabled") || msg.includes("not_found")
                ? 400
                : 500;
        return NextResponse.json({ error: msg }, { status });
    }
    return NextResponse.json(data ?? { ok: true });
}
