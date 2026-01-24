// app/api/print/agents/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export async function POST(req: Request) {
    const access = await requireCompanyAccess(["owner", "admin"]);
    if (!access?.ok) return NextResponse.json({ error: access?.error || "forbidden" }, { status: access?.status || 403 });

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const apiKey = crypto.randomBytes(24).toString("hex");
    const prefix = apiKey.slice(0, 8);
    const hash = await bcrypt.hash(apiKey, 10);

    const admin = createAdminClient();
    const { data, error } = await admin.from("print_agents").insert([{
        company_id: access.companyId,
        name,
        api_key_hash: hash,
        api_key_prefix: prefix,
        is_active: true
    }]).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        agent: { id: data.id, name: data.name, created_at: data.created_at },
        api_key: apiKey
    }, { status: 201 });
}
