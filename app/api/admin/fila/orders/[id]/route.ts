import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const id = String(rawId ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action ?? "").trim();
    if (action === "confirm") {
        const now = new Date().toISOString();
        const { error } = await admin
            .from("orders")
            .update({ confirmation_status: "confirmed", confirmed_at: now })
            .eq("id", id)
            .eq("company_id", companyId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
        const { error } = await admin.rpc("rpc_admin_cancel_order", {
            p_company_id: companyId,
            p_order_id: id,
            p_reject_confirmation: true,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
