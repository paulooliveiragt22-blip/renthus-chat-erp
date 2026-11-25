import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { upsertOfferingSchema } from "@/src/service/http/schemas";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const result = await callServiceRpc(ctx.admin, "rpc_service_list_offerings", {
        p_company_id: ctx.companyId,
    });
    return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request) {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const parsed = upsertOfferingSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "offering_invalid" }, { status: 400 });
    const result = await callServiceRpc(ctx.admin, "rpc_service_upsert_offering", {
        p_company_id: ctx.companyId,
        p_offering_id: parsed.data.id ?? null,
        p_name: parsed.data.name,
        p_description: parsed.data.description ?? null,
        p_duration_min: parsed.data.durationMin,
        p_price_cents: parsed.data.priceCents,
        p_active: parsed.data.active ?? true,
        p_link_url: parsed.data.linkUrl?.trim() ? parsed.data.linkUrl.trim() : null,
        p_link_label: parsed.data.linkUrl?.trim() ? (parsed.data.linkLabel ?? "Ver oferta") : null,
    });
    return NextResponse.json(result.body, { status: result.status });
}
