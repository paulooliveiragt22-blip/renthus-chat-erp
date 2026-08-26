import { NextRequest, NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    civilRangeToUtcBounds,
    loadCompanyTimezone,
} from "@/src/financeiro/application/cashRevenue";
import { asMoney } from "@/src/financeiro/domain/money";

export const runtime = "nodejs";

type DreRow = {
    account_name?: string;
    account_type?: string;
    total?: number | string;
};

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyPlanFeature("financeiro_full", ["owner", "admin", "member"], "financeiro.read");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const from = String(req.nextUrl.searchParams.get("from") ?? "").trim();
    const to = String(req.nextUrl.searchParams.get("to") ?? "").trim();
    if (!from || !to) return NextResponse.json({ error: "from_to_required" }, { status: 400 });

    try {
        const timeZone = await loadCompanyTimezone(admin, companyId);
        const bounds = civilRangeToUtcBounds(from, to, timeZone);
        const { data, error } = await admin.rpc("rpc_fin_dre", {
            p_company_id: companyId,
            p_from: bounds.from.toISOString(),
            p_to: bounds.toExclusive.toISOString(),
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const raw = Array.isArray(data) ? (data as DreRow[]) : [];
        const rows = raw
            .map((r) => ({
                account_name: String(r.account_name ?? ""),
                account_type: String(r.account_type ?? ""),
                total: asMoney(r.total),
            }))
            .filter((r) => r.account_name && r.account_type);

        return NextResponse.json({ rows, from, to, timezone: timeZone });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "dre_failed";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
