// app/api/print/companies/[companyId]/printers/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAgentByApiKey } from "@/lib/print/agents";

export async function GET(req: Request, { params }: { params: { companyId: string } }) {
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const agent = await verifyAgentByApiKey(auth);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const companyId = params.companyId;
    if (String(agent.company_id) !== String(companyId)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.from("printers").select("*").eq("company_id", companyId).eq("is_active", true);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ printers: data || [] });
}
