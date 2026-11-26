import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { applyPresetSchema, channelFlagsSchema, saveContextSchema, siteChatRepliesSchema } from "@/src/service/http/schemas";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const body: unknown = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as { action?: unknown }) : null;
    const action = record?.action;

    if (action === "preset") {
        const parsed = applyPresetSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_preset" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_apply_preset", {
            p_company_id: ctx.companyId,
            p_preset: parsed.data.preset,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    if (action === "context") {
        const parsed = saveContextSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_context" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_save_context", {
            p_company_id: ctx.companyId,
            p_context_text: parsed.data.contextText,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    if (action === "replies") {
        const parsed = siteChatRepliesSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_replies" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_save_site_replies", {
            p_company_id: ctx.companyId,
            p_replies: parsed.data.replies,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    if (action === "flags") {
        const parsed = channelFlagsSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_flags" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_set_channel_flags", {
            p_company_id: ctx.companyId,
            p_cancel: parsed.data.cancelEnabled,
            p_reschedule: parsed.data.rescheduleEnabled,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
