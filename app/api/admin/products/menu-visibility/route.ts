import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    const ctx = await requireCapability("products.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;
    const body = (await req.json().catch(() => ({}))) as { productId?: string; showOnMenu?: boolean };
    const productId = String(body.productId ?? "").trim();
    if (!productId) return NextResponse.json({ error: "product_id_required" }, { status: 400 });
    const { error } = await admin.rpc("rpc_set_product_show_on_menu", {
        p_company_id: companyId,
        p_product_id: productId,
        p_value: body.showOnMenu !== false,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
}
