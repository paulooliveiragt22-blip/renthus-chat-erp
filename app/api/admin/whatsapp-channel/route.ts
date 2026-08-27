import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    setWhatsappChannelStatus,
    upsertWhatsappChannelCredentials,
} from "@/lib/channels/upsertWhatsappChannelCredentials";
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
                "id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at, provisioning_mode, credential_source, last_health_at, last_health_ok, last_health_error"
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
            note: "Phone Number ID e token devem pertencer ao mesmo Meta App cujo webhook o Renthus valida.",
        },
    });
}

export async function PUT(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, userId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        phoneNumberId?: string;
        wabaId?: string | null;
        accessToken?: string;
        whatsappPhone?: string | null;
    };

    const phoneNumberId =
        typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
    if (!phoneNumberId) {
        return NextResponse.json({ error: "phone_number_id_required" }, { status: 400 });
    }

    try {
        const result = await upsertWhatsappChannelCredentials(admin, {
            companyId,
            phoneNumberId,
            accessToken: body.accessToken,
            wabaId: body.wabaId,
            whatsappPhone: body.whatsappPhone,
            actor: { kind: "company_user", userId },
        });
        return NextResponse.json({
            connection: result.channel,
            created: result.created,
            webhookPath: "/api/whatsapp/incoming",
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status =
            msg === "encryption_unavailable"
                ? 500
                : msg === "token_required" || msg === "phone_number_id_required"
                  ? 400
                  : msg === "phone_number_id_conflict"
                    ? 409
                    : 500;
        return NextResponse.json(
            {
                error: msg,
                hint:
                    msg === "encryption_unavailable"
                        ? "Defina CREDENTIALS_ENCRYPTION_KEY (32 bytes base64)."
                        : msg === "phone_number_id_conflict"
                          ? "Este Phone Number ID já está vinculado a outra empresa."
                          : undefined,
            },
            { status }
        );
    }
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
