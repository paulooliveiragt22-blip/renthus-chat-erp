import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function PUT(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        order_id?: string;
        items?: Array<Record<string, unknown>>;
    };
    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });
    const items = Array.isArray(body.items) ? body.items : [];

    const { error: delErr } = await admin
        .from("order_items")
        .delete()
        .eq("order_id", orderId)
        .eq("company_id", companyId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (items.length > 0) {
        const payload = items.map((it) => ({ ...it, order_id: orderId, company_id: companyId }));
        const { error: insErr } = await admin.from("order_items").insert(payload);
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
