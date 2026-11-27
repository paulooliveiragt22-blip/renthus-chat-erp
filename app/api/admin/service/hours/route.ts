import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

const windowSchema = z
    .object({
        dow: z.number().int().min(0).max(6),
        open: z.string().regex(/^\d{2}:\d{2}$/),
        close: z.string().regex(/^\d{2}:\d{2}$/),
    })
    .strict();

const bodySchema = z
    .object({
        windows: z.array(windowSchema).max(14),
    })
    .strict();

export async function GET() {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const result = await callServiceRpc(ctx.admin, "rpc_service_get_attendance_windows", {
        p_company_id: ctx.companyId,
    });
    return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request) {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, code: "invalid_window" }, { status: 400 });
    const result = await callServiceRpc(ctx.admin, "rpc_service_set_attendance_windows", {
        p_company_id: ctx.companyId,
        p_windows: parsed.data.windows,
    });
    return NextResponse.json(result.body, { status: result.status });
}
