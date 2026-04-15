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

    const logradouro = String(body.logradouro ?? "").trim();
    const numero     = String(body.numero ?? "").trim();
    const bairro       = String(body.bairro ?? "").trim();

    const rpcPayload: {
        customer: Record<string, unknown>;
        address?: Record<string, unknown>;
    } = {
        customer: {
            origem: "admin",
            name,
            phone,
            cpf_cnpj: String(body.cpf_cnpj ?? "").trim() || null,
            limite_credito: Number.parseFloat(String(body.limite_credito ?? "0")) || 0,
        },
    };
    if (logradouro || bairro || numero) {
        rpcPayload.address = {
            apelido: "Principal",
            logradouro: logradouro || null,
            numero: numero || null,
            bairro: bairro || null,
            is_principal: true,
        };
    }

    const { data: newId, error } = await admin.rpc("rpc_upsert_customer_with_primary_address", {
        p_company_id: companyId,
        p_payload: rpcPayload,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data, error: selErr } = await admin
        .from("customers")
        .select("id,name,phone,limite_credito,saldo_devedor")
        .eq("id", newId as string)
        .eq("company_id", companyId)
        .single();
    if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
    return NextResponse.json({ customer: data });
}
