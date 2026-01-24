// app/api/print/jobs/poll/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAgentByApiKey, updateAgentLastSeen } from "@/lib/print/agents";

export async function GET(req: Request) {
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const agent = await verifyAgentByApiKey(auth);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();

    // Call RPC to reserve a print job atomically
    try {
        const { data, error } = await admin.rpc("reserve_print_job", {
            p_company: agent.company_id,
            p_agent: agent.id
        });

        if (error) {
            console.error("reserve_print_job rpc error:", error.message);
            return NextResponse.json({ jobs: [] });
        }

        // rpc may return array or object; normalize
        let jobs = [];
        if (!data) jobs = [];
        else if (Array.isArray(data)) jobs = data;
        else jobs = [data];

        // Update last_seen asynchronously
        updateAgentLastSeen(agent.id).catch(() => { });

        // Return jobs as delivered
        return NextResponse.json({ jobs });
    } catch (e) {
        console.error("poll error:", e);
        return NextResponse.json({ jobs: [] });
    }
}
