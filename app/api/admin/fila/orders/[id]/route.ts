import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const id = String(params.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action ?? "").trim();
    const now = new Date().toISOString();

    if (action === "confirm") {
        const { error } = await admin
            .from("orders")
            .update({ confirmation_status: "confirmed", confirmed_at: now })
            .eq("id", id)
            .eq("company_id", companyId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
        const { error } = await admin
            .from("orders")
            .update({
                confirmation_status: "rejected",
                confirmed_at: now,
                status: "canceled",
            })
            .eq("id", id)
            .eq("company_id", companyId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
