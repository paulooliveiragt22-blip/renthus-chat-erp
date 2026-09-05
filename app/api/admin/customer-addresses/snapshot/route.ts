import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

/**
 * Snapshot enxuto de endereços da empresa (P5a / Pedidos offline).
 * GET → { addresses: [{ customer_id, id, apelido, ... }] }
 */
export async function GET() {
    const ctx = await requireCapability("customers.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("enderecos_cliente")
        .select(
            "id,customer_id,apelido,logradouro,numero,complemento,bairro,cidade,estado,cep,is_principal"
        )
        .eq("company_id", companyId)
        .order("is_principal", { ascending: false })
        .limit(2_000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        addresses: (data ?? []).map((r) => ({
            id: String(r.id),
            customer_id: String(r.customer_id),
            apelido: String(r.apelido ?? "Entrega"),
            logradouro: r.logradouro == null ? null : String(r.logradouro),
            numero: r.numero == null ? null : String(r.numero),
            complemento: r.complemento == null ? null : String(r.complemento),
            bairro: r.bairro == null ? null : String(r.bairro),
            cidade: r.cidade == null ? null : String(r.cidade),
            estado: r.estado == null ? null : String(r.estado),
            cep: r.cep == null ? null : String(r.cep),
            is_principal: Boolean(r.is_principal),
        })),
    });
}
