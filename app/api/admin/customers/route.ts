import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("customers")
        .select(
            "id,company_id,name,phone,phone_e164,address,neighborhood,cpf_cnpj,tipo_pessoa,limite_credito,saldo_devedor,origem,email,notes,is_adult,created_at"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(500);

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

    const { data: newId, error } = await admin.rpc("rpc_upsert_customer_with_primary_address", {
        p_company_id: companyId,
        p_payload: {
            customer: {
                origem: "admin",
                name,
                phone,
                email: String(body.email ?? "").trim() || null,
                cpf_cnpj: String(body.cpf_cnpj ?? "").trim() || null,
                tipo_pessoa: String(body.tipo_pessoa ?? "PF"),
                limite_credito: Number.parseFloat(String(body.limite_credito ?? "0")) || 0,
                notes: String(body.notes ?? "").trim() || null,
            },
        },
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data, error: selErr } = await admin
        .from("customers")
        .select(
            "id,company_id,name,phone,phone_e164,address,neighborhood,cpf_cnpj,tipo_pessoa,limite_credito,saldo_devedor,origem,email,notes,is_adult,created_at"
        )
        .eq("id", newId as string)
        .eq("company_id", companyId)
        .single();
    if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
    return NextResponse.json({ customer: data });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { error } = await admin.rpc("rpc_upsert_customer_with_primary_address", {
        p_company_id: companyId,
        p_payload: {
            customer: {
                id,
                name: String(body.name ?? "").trim(),
                phone: String(body.phone ?? "").trim(),
                email: String(body.email ?? "").trim() || null,
                cpf_cnpj: String(body.cpf_cnpj ?? "").trim() || null,
                tipo_pessoa: String(body.tipo_pessoa ?? "PF"),
                limite_credito: Number.parseFloat(String(body.limite_credito ?? "0")) || 0,
                notes: String(body.notes ?? "").trim() || null,
            },
        },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { error } = await admin.from("customers").delete().eq("id", id).eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
