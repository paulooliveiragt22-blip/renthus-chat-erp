// app/api/print/agents/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export async function POST(req: Request) {
    // require company owner/admin
    const access = await requireCompanyAccess(["owner", "admin"]);
    if (!access || !access.ok) {
        const status = access?.status || 403;
        const msg = access?.error || "forbidden";
        return NextResponse.json({ error: msg }, { status });
    }
    const companyId = access.companyId;

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    // generate api_key
    const apiKey = crypto.randomBytes(24).toString("hex"); // 48 hex chars
    const prefix = apiKey.slice(0, 8);
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    const admin = createAdminClient();
    const { data, error } = await admin
        .from("print_agents")
        .insert([{
            company_id: companyId,
            name,
            api_key_hash: apiKeyHash,
            api_key_prefix: prefix,
            is_active: true
        }])
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return the API key only once
    return NextResponse.json({
        agent: {
            id: data.id,
            name: data.name,
            company_id: data.company_id,
            created_at: data.created_at,
            is_active: data.is_active
        },
        api_key: apiKey
    }, { status: 201 });
}
