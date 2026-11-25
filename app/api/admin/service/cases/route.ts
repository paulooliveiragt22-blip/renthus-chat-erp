import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { setLabelSchema, setStageSchema } from "@/src/service/http/schemas";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const result = await callServiceRpc(ctx.admin, "rpc_service_list_company_cases", {
        p_company_id: ctx.companyId,
    });
    return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request) {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const body: unknown = await req.json().catch(() => null);
    const action = body && typeof body === "object" && "action" in body ? body.action : null;

    if (action === "stage") {
        const parsed = setStageSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_set_case_stage", {
            p_company_id: ctx.companyId,
            p_case_id: parsed.data.caseId,
            p_stage: parsed.data.stage,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    if (action === "label") {
        const parsed = setLabelSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_title" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_set_stage_label", {
            p_company_id: ctx.companyId,
            p_stage: parsed.data.stage,
            p_label: parsed.data.label,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
