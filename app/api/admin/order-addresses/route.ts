import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const customerId = String(req.nextUrl.searchParams.get("customer_id") ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "customer_id_required" }, { status: 400 });

    const { data, error } = await admin
        .from("enderecos_cliente")
        .select("id,apelido,logradouro,numero,complemento,bairro,cidade,estado,cep,is_principal")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .order("is_principal", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ addresses: data ?? [] });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const customerId = String(body.customer_id ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "customer_id_required" }, { status: 400 });

    const payload = {
        company_id: companyId,
        customer_id: customerId,
        apelido: String(body.apelido ?? "").trim() || "Entrega",
        logradouro: String(body.logradouro ?? "").trim() || null,
        numero: String(body.numero ?? "").trim() || null,
        complemento: String(body.complemento ?? "").trim() || null,
        bairro: String(body.bairro ?? "").trim() || null,
        cidade: String(body.cidade ?? "").trim() || null,
        estado: String(body.estado ?? "").trim() || null,
        cep: String(body.cep ?? "").trim() || null,
        is_principal: Boolean(body.is_principal),
    };

    const { data, error } = await admin.from("enderecos_cliente").insert(payload).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id: data.id as string });
}
