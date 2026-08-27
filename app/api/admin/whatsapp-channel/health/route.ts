import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { probeWhatsappChannelHealth } from "@/lib/channels/probeWhatsappChannelHealth";
import { sanitizeWhatsappChannelForClient } from "@/lib/whatsapp/channelCredentials";

export const runtime = "nodejs";

export async function POST() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const health = await probeWhatsappChannelHealth(admin, companyId);

    const { data: channel } = await admin
        .from("whatsapp_channels")
        .select(
            "id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at, provisioning_mode, credential_source, last_health_at, last_health_ok, last_health_error"
        )
        .eq("company_id", companyId)
        .eq("provider", "meta")
        .maybeSingle();

    return NextResponse.json({
        health,
        connection: channel ? sanitizeWhatsappChannelForClient(channel) : null,
    });
}
