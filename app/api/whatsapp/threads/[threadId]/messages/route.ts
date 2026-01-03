import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(
    req: Request,
    { params }: { params: { threadId: string } }
) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const { admin, companyId } = ctx;

    // garante que a thread pertence à empresa
    const { data: thread } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("id", params.threadId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (!thread) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const { data, error } = await admin
        .from("whatsapp_messages")
        .select(
            "id, direction, provider, from_addr, to_addr, body, status, created_at"
        )
        .eq("thread_id", params.threadId)
        .order("created_at", { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: data ?? [] });
}
