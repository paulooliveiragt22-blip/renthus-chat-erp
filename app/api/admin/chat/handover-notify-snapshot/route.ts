import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

/**
 * Snapshot leve: threads em handover humano (WA / IG / Messenger).
 * GET → { handovers } para alerta → /whatsapp?t=
 */
export async function GET() {
    // Inbox operators; fallback dashboard (tela Suporte)
    let ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) {
        ctx = await requireCapability("dashboard.view");
    }
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("whatsapp_threads")
        .select("id, profile_name, phone_e164, channel, handover_at, bot_active")
        .eq("company_id", companyId)
        .eq("bot_active", false)
        .not("handover_at", "is", null)
        .order("handover_at", { ascending: false })
        .limit(40);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = data ?? [];
    return NextResponse.json({
        handovers: rows.map((r) => ({
            threadId: String(r.id),
            handoverAt: String(r.handover_at),
            channel: r.channel == null ? null : String(r.channel),
            profileName: r.profile_name == null ? null : String(r.profile_name),
            phoneE164: r.phone_e164 == null ? null : String(r.phone_e164),
            reason: null as string | null,
        })),
    });
}
