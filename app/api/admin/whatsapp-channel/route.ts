import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { enforceKeyRateLimitAsync } from "@/lib/security/rateLimitDistributed";
import { describeWhatsappMigrateOffer, listAdministeredWhatsappChannels } from "@/lib/channels/migrateWhatsappChannel";
import { upsertWhatsappChannelCredentials, setWhatsappChannelStatus } from "@/lib/channels/upsertWhatsappChannelCredentials";
import { sanitizeWhatsappChannelForClient } from "@/lib/whatsapp/channelCredentials";
import { whatsappTenantPasteBodySchema } from "@/src/domain/contracts/embeddedSignup";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, userId } = ctx;

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

    let catalog: Awaited<ReturnType<typeof listAdministeredWhatsappChannels>>;
    try {
        catalog = await listAdministeredWhatsappChannels(admin, userId, companyId);
    } catch (e) {
        const msg = e instanceof Error ? e.message : "list_failed";
        return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({
        connection: channel ? sanitizeWhatsappChannelForClient(channel) : null,
        displayPhone: company?.whatsapp_phone ?? null,
        currentName: catalog.currentName,
        currentMode: catalog.currentMode,
        administered: catalog.channels,
        webhookPath: "/api/whatsapp/incoming",
        guide: {
            appMustMatchPlatformWebhook: true,
            note: "Embedded Signup ou credenciais coladas. O número precisa ser do mesmo App Meta do webhook.",
        },
    });
}

function statusForPasteError(code: string): number {
    switch (code) {
        case "encryption_unavailable":
            return 503;
        case "phone_number_id_required":
        case "token_required":
            return 400;
        case "phone_number_id_conflict":
            return 409;
        default:
            return 500;
    }
}

/** Credenciais coladas pelo lojista. O número precisa ser do mesmo App Meta do webhook. */
export async function PUT(req: Request) {
    const ctx = await requireCompanyPlanFeature("whatsapp_messages", ["owner", "admin"]);
    if (!ctx.ok) return ctx.response;

    const limited = await enforceKeyRateLimitAsync(
        `wa_tenant_paste:${ctx.companyId}`,
        8,
        10 * 60 * 1000,
        { error: "rate_limit_exceeded", hint: "Aguarde alguns minutos e tente de novo." }
    );
    if (limited) return limited;

    const raw = (await req.json().catch(() => null)) as unknown;
    const parsed = whatsappTenantPasteBodySchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const wabaId = parsed.data.wabaId?.trim() ? parsed.data.wabaId.trim() : null;
    const displayPhone = parsed.data.displayPhone?.trim() ? parsed.data.displayPhone.trim() : null;

    try {
        const result = await upsertWhatsappChannelCredentials(ctx.admin, {
            companyId: ctx.companyId,
            phoneNumberId: parsed.data.phoneNumberId,
            accessToken: parsed.data.accessToken,
            wabaId,
            whatsappPhone: displayPhone,
            actor: { kind: "company_user", userId: ctx.userId },
            provisioningMode: "tenant_paste",
        });
        return NextResponse.json({
            connection: result.channel,
            created: result.created,
            webhookPath: "/api/whatsapp/incoming",
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "paste_failed";
        if (msg === "phone_number_id_conflict") {
            const offer = await describeWhatsappMigrateOffer(
                ctx.admin,
                ctx.userId,
                ctx.companyId,
                parsed.data.phoneNumberId
            );
            if (offer) {
                return NextResponse.json(
                    {
                        error: "whatsapp_already_registered",
                        canMigrate: true,
                        sourceName: offer.sourceName,
                        sourceMode: offer.sourceMode,
                        targetMode: offer.targetMode,
                    },
                    { status: 409 }
                );
            }
        }
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
            { status: statusForPasteError(msg) }
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
