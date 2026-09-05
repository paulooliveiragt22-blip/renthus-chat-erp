import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCapability("customers.read");
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
    const ctx = await requireCapability("customers.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const customerId = String(body.customer_id ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "customer_id_required" }, { status: 400 });

    const logradouro = String(body.logradouro ?? "").trim();
    const numero = String(body.numero ?? "").trim();
    const bairro = String(body.bairro ?? "").trim();
    const cidade = String(body.cidade ?? "").trim();
    const estado = String(body.estado ?? "").trim().toUpperCase();

    if (!logradouro) {
        return NextResponse.json({ error: "logradouro_required" }, { status: 400 });
    }
    if (!numero) {
        return NextResponse.json({ error: "numero_required" }, { status: 400 });
    }
    if (!bairro) {
        return NextResponse.json({ error: "bairro_required" }, { status: 400 });
    }
    if (!cidade) {
        return NextResponse.json({ error: "cidade_required" }, { status: 400 });
    }
    if (estado.length !== 2) {
        return NextResponse.json(
            { error: "estado_required", detail: "UF deve ter 2 letras (ex.: SP)." },
            { status: 400 }
        );
    }

    const payload = {
        company_id: companyId,
        customer_id: customerId,
        apelido: String(body.apelido ?? "").trim() || "Entrega",
        logradouro,
        numero,
        complemento: String(body.complemento ?? "").trim() || null,
        bairro,
        cidade,
        estado,
        cep: String(body.cep ?? "").trim() || null,
        is_principal: Boolean(body.is_principal),
    };

    const { data, error } = await admin.from("enderecos_cliente").insert(payload).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id: data.id as string });
}
