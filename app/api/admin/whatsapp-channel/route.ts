import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { setWhatsappChannelStatus } from "@/lib/channels/upsertWhatsappChannelCredentials";
import { sanitizeWhatsappChannelForClient } from "@/lib/whatsapp/channelCredentials";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const [{ data: channel, error }, { data: company }] = await Promise.all([
        admin
            .from("whatsapp_channels")
            .select(
                "id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at, provisioning_mode, credential_source, last_health_at, last_health_ok, last_health_error, is_on_biz_app, token_expires_at"
            )
            .eq("company_id", companyId)
            .eq("provider", "meta")
            .maybeSingle(),
        admin.from("companies").select("whatsapp_phone").eq("id", companyId).maybeSingle(),
    ]);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        connection: channel ? sanitizeWhatsappChannelForClient(channel) : null,
        displayPhone: company?.whatsapp_phone ?? null,
        webhookPath: "/api/whatsapp/incoming",
        guide: {
            appMustMatchPlatformWebhook: true,
            note: "Conecte pelo Embedded Signup. O número passa a pertencer ao Meta App da plataforma.",
        },
    });
}

/** Paste de token no tenant removido (ADR-0010). Use Embedded Signup. */
export async function PUT() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    return NextResponse.json(
        {
            error: "tenant_paste_removed",
            hint: "Use Conectar WhatsApp (Embedded Signup) na aba Canais.",
        },
        { status: 410 }
    );
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, userId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        status?: "active" | "inactive";
    };
    if (body.status !== "active" && body.status !== "inactive") {
        return NextResponse.json({ error: "status_invalid" }, { status: 400 });
    }

    try {
        const connection = await setWhatsappChannelStatus(admin, {
            companyId,
            status: body.status,
            actor: { kind: "company_user", userId },
        });
        if (!connection) {
            return NextResponse.json({ error: "no_channel" }, { status: 404 });
        }
        return NextResponse.json({ connection });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
