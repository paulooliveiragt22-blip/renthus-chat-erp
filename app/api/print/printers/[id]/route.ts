// app/api/print/printers/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAgentByApiKey } from "@/lib/print/agents";

export async function GET(req: Request, { params }: { params: { id: string } }) {
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const agent = await verifyAgentByApiKey(auth);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdminClient();
    const { data: printer, error } = await admin.from("printers").select("*").eq("id", params.id).maybeSingle();
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!printer) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (String(printer.company_id) !== String(agent.company_id)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    return NextResponse.json({ printer });
}
