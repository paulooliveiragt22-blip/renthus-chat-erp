import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { enforceKeyRateLimitAsync } from "@/lib/security/rateLimitDistributed";
import { embeddedSignupCompleteBodySchema } from "@/src/domain/contracts/embeddedSignup";
import { completeWhatsappEmbeddedSignup } from "@/lib/channels/completeWhatsappEmbeddedSignup";

export const runtime = "nodejs";

function statusForCompleteError(code: string): number {
    switch (code) {
        case "meta_app_credentials_missing":
        case "embedded_signup_not_configured":
        case "encryption_unavailable":
            return 503;
        case "embedded_signup_code_required":
        case "waba_id_required":
        case "phone_number_id_required":
            return 400;
        case "embedded_signup_code_exchange_failed":
        case "embedded_signup_token_invalid":
        case "embedded_signup_token_wrong_app":
        case "waba_phone_number_unresolved":
            return 422;
        case "phone_number_id_conflict":
            return 409;
        case "waba_subscribe_failed":
        case "phone_register_failed":
            return 502;
        default:
            return /permiss/i.test(code) || code === "meta_scopes_rejected" ? 422 : 500;
    }
}

export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature("whatsapp_messages", ["owner", "admin"]);
    if (!ctx.ok) return ctx.response;

    const limited = await enforceKeyRateLimitAsync(
        `wa_embedded_signup:${ctx.companyId}`,
        5,
        10 * 60 * 1000,
        { error: "rate_limit_exceeded", hint: "Aguarde alguns minutos e tente de novo." }
    );
    if (limited) return limited;

    const raw = (await req.json().catch(() => null)) as unknown;
    const parsed = embeddedSignupCompleteBodySchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    try {
        const result = await completeWhatsappEmbeddedSignup(ctx.admin, {
            companyId: ctx.companyId,
            userId: ctx.userId,
            ...parsed.data,
        });
        return NextResponse.json({
            connection: result.channel,
            created: result.created,
            coexistence: result.coexistence,
            webhookPath: "/api/whatsapp/incoming",
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "embedded_signup_failed";
        return NextResponse.json(
            {
                error: msg,
                hint:
                    msg === "encryption_unavailable"
                        ? "Defina CREDENTIALS_ENCRYPTION_KEY (32 bytes base64)."
                        : msg === "phone_number_id_conflict"
                          ? "Este Phone Number ID já está vinculado a outra empresa."
                          : msg === "embedded_signup_code_exchange_failed"
                            ? "O código da Meta expirou ou já foi usado. Abra o popup de novo."
                            : undefined,
            },
            { status: statusForCompleteError(msg) }
        );
    }
}
