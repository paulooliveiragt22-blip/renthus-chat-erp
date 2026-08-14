/**
 * POST /api/admin/products/siglas — cria via rpc_create_sigla
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    const ctx = await requireCapability("products.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as { sigla?: string; descricao?: string | null };
    const sigla = String(body.sigla ?? "").trim();
    if (!sigla) return NextResponse.json({ error: "sigla_required" }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_create_sigla", {
        p_company_id: companyId,
        p_sigla: sigla,
        p_descricao: body.descricao?.trim() || null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        id: String(data),
        sigla: sigla.toUpperCase(),
    });
}
