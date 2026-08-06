import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;
    const { searchParams } = new URL(req.url);

    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const q = (searchParams.get("q") ?? "").trim();

    let query = admin
        .from("whatsapp_threads")
        .select(
            "id, phone_e164, profile_name, last_message_at, last_inbound_at, last_message_preview, created_at, bot_active, handover_at, unread_count, channel_id, channel, external_id"
        )
        .eq("company_id", companyId)
        .order("last_message_at", { ascending: false })
        .limit(Number.isFinite(limit) ? limit : 50);

    if (q) {
        // telefone, nome ou external_id (IGSID/PSID)
        query = query.or(
            `phone_e164.ilike.%${q}%,profile_name.ilike.%${q}%,external_id.ilike.%${q}%`
        );
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ threads: data ?? [] });
}
