import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        order_id?: string;
        type?: string;
        amount?: number;
        payment_method?: string;
        description?: string | null;
        reference_date?: string;
    };

    const amount = Number(body.amount ?? 0);
    if (!body.order_id) return NextResponse.json({ error: "order_id_required" }, { status: 400 });
    if (!body.type) return NextResponse.json({ error: "type_required" }, { status: 400 });
    if (amount <= 0) return NextResponse.json({ error: "amount_invalid" }, { status: 400 });

    const { data, error } = await admin
        .from("financial_entries")
        .insert({
            company_id: companyId,
            order_id: body.order_id,
            type: body.type,
            amount,
            payment_method: body.payment_method ?? "pix",
            description: body.description ?? null,
            reference_date: body.reference_date ?? new Date().toISOString().slice(0, 10),
        })
        .select("id")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: data.id });
}
