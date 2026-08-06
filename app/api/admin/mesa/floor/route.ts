import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const { data: existing } = await admin
        .from("dining_tables")
        .select("id")
        .eq("company_id", companyId)
        .limit(1);
    if (!existing?.length) {
        await admin.rpc("rpc_mesa_seed_default_tables", {
            p_company_id: companyId,
            p_count: 8,
        });
    }

    const { data, error } = await admin.rpc("rpc_mesa_list_floor", {
        p_company_id: companyId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? { ok: true, tables: [] });
}
