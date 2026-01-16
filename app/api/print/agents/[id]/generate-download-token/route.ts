// app/api/print/agents/[id]/generate-download-token/route.ts
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { rotateApiKeyForAgent, createDownloadToken } from "@/lib/print/download";

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const access = await requireCompanyAccess(["owner", "admin"]);
    if (!access || !access.ok) return NextResponse.json({ error: access?.error || "forbidden" }, { status: access?.status || 403 });
    const companyId = access.companyId;
    const agentId = params.id;

    // verify agent belongs to this company
    const admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const { data: agent } = await admin.from("print_agents").select("*").eq("id", agentId).maybeSingle();
    if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    if (String(agent.company_id) !== String(companyId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    // rotate api key (generate a new one and update print_agents)
    try {
        const apiKeyPlain = await rotateApiKeyForAgent(agentId);

        // create a short-lived token tying to the new apiKey
        const { tokenPlain, expiresAt } = await createDownloadToken({
            agentId,
            apiKeyPlain,
            createdBy: access.userId,
            ttlMinutes: 20
        });

        // return download URL to admin (they can send to client)
        const baseUrl = process.env.PUBLIC_URL || (req.url ? new URL(req.url).origin : "");
        const downloadUrl = `${baseUrl}/api/print/agents/${agentId}/download?token=${tokenPlain}&platform=windows`; // platform optional
        return NextResponse.json({ downloadUrl, expiresAt }, { status: 201 });
    } catch (e: any) {
        console.error("generate-download-token error", e);
        return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
}
