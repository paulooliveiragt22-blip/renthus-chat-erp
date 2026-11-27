import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { revokeStoredGoogleToken } from "@/src/service/adapters/google/googleCalendarPort";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function POST() {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    await revokeStoredGoogleToken(ctx.admin, ctx.companyId);
    const result = await callServiceRpc(ctx.admin, "rpc_service_google_disconnect", {
        p_company_id: ctx.companyId,
    });
    return NextResponse.json(result.body, { status: result.status });
}
