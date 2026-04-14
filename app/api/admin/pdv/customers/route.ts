import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ customers: [] });

    const { data, error } = await admin
        .from("customers")
        .select("id,name,phone,limite_credito,saldo_devedor")
        .eq("company_id", companyId)
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ customers: data ?? [] });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    if (!name || !phone) return NextResponse.json({ error: "name_phone_required" }, { status: 400 });

    const address =
        [String(body.logradouro ?? "").trim(), body.numero ? `nº ${String(body.numero).trim()}` : "", String(body.bairro ?? "").trim()]
            .filter(Boolean)
            .join(", ") || null;

    const { data, error } = await admin
        .from("customers")
        .insert({
            company_id: companyId,
            name,
            phone,
            cpf_cnpj: String(body.cpf_cnpj ?? "").trim() || null,
            limite_credito: Number.parseFloat(String(body.limite_credito ?? "0")) || 0,
            origem: "admin",
            address,
            neighborhood: String(body.bairro ?? "").trim() || null,
        })
        .select("id,name,phone,limite_credito,saldo_devedor")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ customer: data });
}
