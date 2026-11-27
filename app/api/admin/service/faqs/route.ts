import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { deleteFaqSchema, upsertFaqSchema } from "@/src/service/http/schemas";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const result = await callServiceRpc(ctx.admin, "rpc_service_list_faqs", {
        p_company_id: ctx.companyId,
        p_active_only: false,
    });
    return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request) {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const parsed = upsertFaqSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "faq_invalid" }, { status: 400 });
    const result = await callServiceRpc(ctx.admin, "rpc_service_upsert_faq", {
        p_company_id: ctx.companyId,
        p_faq_id: parsed.data.id ?? null,
        p_question: parsed.data.question,
        p_answer: parsed.data.answer,
        p_active: parsed.data.active ?? true,
    });
    return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: Request) {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const parsed = deleteFaqSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "faq_invalid" }, { status: 400 });
    const result = await callServiceRpc(ctx.admin, "rpc_service_delete_faq", {
        p_company_id: ctx.companyId,
        p_faq_id: parsed.data.id,
    });
    return NextResponse.json(result.body, { status: result.status });
}
