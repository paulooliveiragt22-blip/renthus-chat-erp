import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const id = String(params.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { data: end, error: e1 } = await admin
        .from("enderecos_cliente")
        .select("id,apelido,logradouro,numero,complemento,bairro,cidade,estado,cep,is_principal")
        .eq("customer_id", id)
        .eq("company_id", companyId)
        .order("is_principal", { ascending: false });
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

    const { data: div, error: e2 } = await admin
        .from("bills")
        .select("id,original_amount,saldo_devedor,due_date,status,description,paid_at,order_id")
        .eq("customer_id", id)
        .eq("type", "receivable")
        .eq("company_id", companyId)
        .neq("status", "canceled")
        .order("due_date", { ascending: false });
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

    const { data: saldoRow } = await admin.from("customers").select("saldo_devedor").eq("id", id).eq("company_id", companyId).maybeSingle();

    return NextResponse.json({
        addresses: end ?? [],
        bills: div ?? [],
        saldo_devedor: saldoRow?.saldo_devedor ?? null,
    });
}
