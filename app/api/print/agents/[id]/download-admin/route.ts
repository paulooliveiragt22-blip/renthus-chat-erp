// app/api/print/agents/[id]/download-admin/route.ts
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { rotateApiKeyForAgent } from "@/lib/print/download";
import { createAdminClient } from "@/lib/supabase/admin";
// We'll reuse the download streaming logic in a shared helper:
import { streamAgentZip } from "@/lib/print/streamZip";

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const access = await requireCompanyAccess(["owner", "admin"]);
    if (!access?.ok) return NextResponse.json({ error: access?.error || "forbidden" }, { status: 403 });
    const agentId = params.id;

    try {
        const admin = createAdminClient();
        const { data: agent } = await admin.from("print_agents").select("*").eq("id", agentId).maybeSingle();
        if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
        if (String(agent.company_id) !== String(access.companyId)) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }

        const apiKey = await rotateApiKeyForAgent(agentId);
        // stream ZIP with the new apiKey (streamAgentZip returns a Response)
        const resp = await streamAgentZip(agentId, apiKey, req);
        return resp;
    } catch (e: any) {
        console.error("download-admin error", e);
        return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
}
