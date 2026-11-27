import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { googleCalendarConfigured } from "@/src/service/adapters/google/googleCalendarHttp";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const result = await callServiceRpc(ctx.admin, "rpc_service_google_status", {
        p_company_id: ctx.companyId,
    });
    const body = result.body && typeof result.body === "object" ? result.body : { ok: false };
    return NextResponse.json(
        { ...body, configured: googleCalendarConfigured() },
        { status: result.status }
    );
}
