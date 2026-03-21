import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

/**
 * POST /api/whatsapp/threads/[threadId]/read
 * Marca a thread como lida: reset unread_count + upsert em whatsapp_thread_reads.
 */
export async function POST(
    _req: Request,
    { params }: { params: { threadId: string } }
) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId, userId } = ctx;
    const threadId = params.threadId;
    if (!threadId) return NextResponse.json({ error: "Missing threadId" }, { status: 400 });

    try {
        // Reset unread_count
        await admin
            .from("whatsapp_threads")
            .update({ unread_count: 0 })
            .eq("id", threadId)
            .eq("company_id", companyId);

        // Upsert last_read_at
        await admin
            .from("whatsapp_thread_reads")
            .upsert(
                {
                    company_id:   companyId,
                    user_id:      userId,
                    thread_id:    threadId,
                    last_read_at: new Date().toISOString(),
                },
                { onConflict: "company_id,user_id,thread_id" }
            );

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Failed" }, { status: 500 });
    }
}
