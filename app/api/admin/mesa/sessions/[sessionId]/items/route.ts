import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";

export const runtime = "nodejs";

export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { data, error } = await admin.rpc("rpc_mesa_add_item", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_payload: body,
    });
    if (error) return mesaRpcError(error, "add_item_failed");
    return NextResponse.json(data ?? { ok: true });
}

export async function PATCH(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;

    const body = (await req.json().catch(() => ({}))) as { itemId?: string; qty?: number };
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    const qty = Number(body.qty);
    if (!itemId) return NextResponse.json({ error: "item_id_required" }, { status: 400 });
    if (!Number.isFinite(qty)) {
        return NextResponse.json({ error: "qty_invalid" }, { status: 400 });
    }

    const { data, error } = await admin.rpc("rpc_mesa_set_item_qty", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_item_id: itemId,
        p_qty: qty,
    });
    if (error) return mesaRpcError(error, "set_qty_failed");
    return NextResponse.json(data ?? { ok: true });
}

export async function DELETE(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;

    const url = new URL(req.url);
    const itemId = url.searchParams.get("itemId")?.trim() || "";
    if (!itemId) return NextResponse.json({ error: "item_id_required" }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_mesa_remove_item", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_item_id: itemId,
    });
    if (error) return mesaRpcError(error, "remove_item_failed");
    return NextResponse.json(data ?? { ok: true });
}
