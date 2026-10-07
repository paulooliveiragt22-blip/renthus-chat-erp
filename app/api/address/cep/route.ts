import { NextRequest, NextResponse } from "next/server";
import { lookupCep, sanitizeCep } from "@/lib/address/cepLookup";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

/**
 * GET /api/address/cep?cep=78898075
 * Proxy server-side (ViaCEP + BrasilAPI) — evita falha de CEP no browser.
 * Gate billing_self: disponível no checkout mesmo com plano pendente.
 *
 * Qualquer membro da empresa pode consultar: a resposta é dado público dos
 * Correios, sem nada do tenant, e o atendente do inbox (que não é owner/admin)
 * precisa do autocomplete ao montar o carrinho do cliente.
 */
export async function GET(req: NextRequest) {
    const access = await requireCompanyAccess({ billing: "billing_self" });
    if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const cep = sanitizeCep(req.nextUrl.searchParams.get("cep") ?? "");
    if (cep.length !== 8) {
        return NextResponse.json({ error: "cep_invalid" }, { status: 400 });
    }

    const data = await lookupCep(cep, 4000);
    if (!data) {
        return NextResponse.json({ error: "cep_not_found" }, { status: 404 });
    }

    return NextResponse.json(data);
}
