import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { migrateWhatsappChannel } from "@/lib/channels/migrateWhatsappChannel";
import { enforceKeyRateLimitAsync } from "@/lib/security/rateLimitDistributed";
import { whatsappTenantPasteBodySchema } from "@/src/domain/contracts/embeddedSignup";

export const runtime = "nodejs";

function statusForMigrateError(code: string): number {
    switch (code) {
        case "encryption_unavailable":
            return 503;
        case "channel_not_found":
            return 404;
        case "migrate_forbidden":
            return 403;
        case "target_has_channel":
        case "phone_number_id_conflict":
            return 409;
        case "phone_number_id_required":
        case "token_required":
            return 400;
        default:
            return 500;
    }
}

export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature("whatsapp_messages", ["owner", "admin"]);
    if (!ctx.ok) return ctx.response;

    const limited = await enforceKeyRateLimitAsync(
        `wa_channel_migrate:${ctx.companyId}`,
        5,
        10 * 60 * 1000,
        { error: "rate_limit_exceeded", hint: "Aguarde alguns minutos e tente de novo." }
    );
    if (limited) return limited;

    const raw = (await req.json().catch(() => null)) as unknown;
    const parsed = whatsappTenantPasteBodySchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    try {
        const result = await migrateWhatsappChannel(ctx.admin, {
            companyId: ctx.companyId,
            userId: ctx.userId,
            phoneNumberId: parsed.data.phoneNumberId,
            accessToken: parsed.data.accessToken,
            wabaId: parsed.data.wabaId?.trim() ? parsed.data.wabaId.trim() : null,
            whatsappPhone: parsed.data.displayPhone?.trim() ? parsed.data.displayPhone.trim() : null,
        });
        return NextResponse.json({
            connection: result.channel,
            created: result.created,
            webhookPath: "/api/whatsapp/incoming",
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "migrate_failed";
        return NextResponse.json(
            {
                error: msg,
                hint:
                    msg === "migrate_forbidden"
                        ? "Este número não pode ser migrado para este perfil."
                        : msg === "target_has_channel"
                          ? "Este perfil já tem um WhatsApp. Remova esse canal antes de migrar."
                          : msg === "encryption_unavailable"
                            ? "Defina CREDENTIALS_ENCRYPTION_KEY (32 bytes base64)."
                            : undefined,
            },
            { status: statusForMigrateError(msg) }
        );
    }
}
