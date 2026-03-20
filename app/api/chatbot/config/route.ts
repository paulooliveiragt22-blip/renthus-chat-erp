import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("chatbots")
        .select("id, name, is_active, config")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ chatbot: null });

    return NextResponse.json({ chatbot: data });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    let body: { id?: string; config?: Record<string, unknown> };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

    if (!body.id || !body.config) return NextResponse.json({ error: "id and config required" }, { status: 400 });

    // Sanity check: only allow editing own company's chatbot
    const { data: existing } = await admin
        .from("chatbots")
        .select("id")
        .eq("id", body.id)
        .eq("company_id", companyId)
        .maybeSingle();

    if (!existing) return NextResponse.json({ error: "chatbot not found" }, { status: 404 });

    const { error } = await admin
        .from("chatbots")
        .update({ config: body.config })
        .eq("id", body.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
}
