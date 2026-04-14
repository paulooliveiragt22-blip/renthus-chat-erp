import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("company_settings")
        .select("require_order_approval, auto_print_orders")
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ settings: data ?? null });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        require_order_approval?: boolean;
        auto_print_orders?: boolean;
    };

    const patch: Record<string, unknown> = {};
    if (body.require_order_approval !== undefined) patch.require_order_approval = Boolean(body.require_order_approval);
    if (body.auto_print_orders !== undefined) patch.auto_print_orders = Boolean(body.auto_print_orders);

    const { error } = await admin
        .from("company_settings")
        .update(patch)
        .eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
