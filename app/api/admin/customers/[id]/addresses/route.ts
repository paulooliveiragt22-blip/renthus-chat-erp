import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const ctxAuth = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctxAuth.ok) return NextResponse.json({ error: ctxAuth.error }, { status: ctxAuth.status });
    const { admin, companyId } = ctxAuth;

    const customerId = String(id ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const isPrincipal = Boolean(body.is_principal);

    const { error } = await admin.from("enderecos_cliente").insert({
        company_id: companyId,
        customer_id: customerId,
        apelido: String(body.apelido ?? "").trim() || "Endereço",
        logradouro: String(body.logradouro ?? "").trim() || null,
        numero: String(body.numero ?? "").trim() || null,
        complemento: String(body.complemento ?? "").trim() || null,
        bairro: String(body.bairro ?? "").trim() || null,
        cidade: String(body.cidade ?? "").trim() || null,
        estado: String(body.estado ?? "").trim() || null,
        cep: String(body.cep ?? "").trim() || null,
        is_principal: isPrincipal,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const ctxAuth = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctxAuth.ok) return NextResponse.json({ error: ctxAuth.error }, { status: ctxAuth.status });
    const { admin, companyId } = ctxAuth;

    const customerId = String(id ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as { address_id?: string; action?: string };
    const addressId = String(body.address_id ?? "").trim();
    if (!addressId || body.action !== "set_principal") {
        return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    const { error } = await admin
        .from("enderecos_cliente")
        .update({ is_principal: true })
        .eq("id", addressId)
        .eq("customer_id", customerId)
        .eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const ctxAuth = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctxAuth.ok) return NextResponse.json({ error: ctxAuth.error }, { status: ctxAuth.status });
    const { admin, companyId } = ctxAuth;

    const customerId = String(id ?? "").trim();
    const addressId = String(req.nextUrl.searchParams.get("address_id") ?? "").trim();
    if (!customerId || !addressId) return NextResponse.json({ error: "ids_required" }, { status: 400 });

    const { error } = await admin
        .from("enderecos_cliente")
        .delete()
        .eq("id", addressId)
        .eq("customer_id", customerId)
        .eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
