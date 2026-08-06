import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { data, error } = await admin.rpc("rpc_mesa_add_item", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_payload: body,
    });
    if (error) {
        const msg = error.message || "add_item_failed";
        const status = msg.includes("invalid") || msg.includes("not_open") ? 400 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
    return NextResponse.json(data ?? { ok: true });
}

export async function PATCH(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "staff"]);
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
    if (error) {
        const msg = error.message || "set_qty_failed";
        const status = msg.includes("not_found") || msg.includes("not_open") ? 400 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
    return NextResponse.json(data ?? { ok: true });
}

export async function DELETE(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "staff"]);
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
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? { ok: true });
}
