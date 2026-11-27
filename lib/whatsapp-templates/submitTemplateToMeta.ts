import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { metaGraphPostJson } from "@/lib/whatsapp/metaGraphFetch";
import type {
    SubmitWhatsappTemplateBody,
    TemplateButton,
    WhatsappTemplatePublic,
} from "@/src/domain/contracts/whatsappTemplates";
import {
    loadActiveWaChannelCreds,
    toPublicTemplate,
} from "@/lib/whatsapp-templates/syncTemplatesFromMeta";
import { parseMetaGraphError } from "@/lib/whatsapp-templates/metaGraphError";

const GRAPH_BASE =
    process.env.WHATSAPP_BASE_URL?.replace(/\/$/, "") ||
    "https://graph.facebook.com/v20.0";

export function countPlaceholders(text: string): number {
    const matches = text.match(/\{\{\d+\}\}/g);
    return matches ? new Set(matches).size : 0;
}

export function buildMetaTemplateComponents(
    body: SubmitWhatsappTemplateBody
): Array<Record<string, unknown>> {
    if (body.category === "AUTHENTICATION") {
        const components: Array<Record<string, unknown>> = [
            {
                type: "BODY",
                add_security_recommendation: body.addSecurityRecommendation === true,
            },
        ];
        if (body.codeExpirationMinutes) {
            components.push({
                type: "FOOTER",
                code_expiration_minutes: body.codeExpirationMinutes,
            });
        }
        const otp: Record<string, unknown> = {
            type: "OTP",
            otp_type: body.otpType ?? "COPY_CODE",
        };
        if (body.otpType === "ONE_TAP") {
            otp.supported_apps = [
                {
                    package_name: body.packageName,
                    signature_hash: body.signatureHash,
                },
            ];
        }
        components.push({ type: "BUTTONS", buttons: [otp] });
        return components;
    }

    const components: Array<Record<string, unknown>> = [];
    const limited = body.category === "MARKETING" && body.marketingKind === "limited_time_offer";

    if (limited) {
        components.push({
            type: "LIMITED_TIME_OFFER",
            limited_time_offer: {
                text: body.offerText,
                has_expiration: body.offerHasExpiration === true,
            },
        });
    }

    if (!limited && body.headerText?.trim()) {
        const header: Record<string, unknown> = {
            type: "HEADER",
            format: "TEXT",
            text: body.headerText.trim(),
        };
        if (countPlaceholders(body.headerText) > 0 && body.headerExample?.trim()) {
            header.example = { header_text: [body.headerExample.trim()] };
        }
        components.push(header);
    }

    const bodyText = body.bodyText ?? "";
    const placeholderCount = countPlaceholders(bodyText);
    const examples = body.exampleBodyValues ?? [];
    const bodyComp: Record<string, unknown> = {
        type: "BODY",
        text: bodyText,
    };
    if (placeholderCount > 0) {
        bodyComp.example = {
            body_text: [examples.slice(0, placeholderCount)],
        };
    }
    components.push(bodyComp);

    if (!limited && body.footerText?.trim()) {
        components.push({ type: "FOOTER", text: body.footerText.trim() });
    }

    const buttons = body.buttons ?? [];
    if (buttons.length > 0) {
        components.push({
            type: "BUTTONS",
            buttons: buttons.map(toMetaButton),
        });
    }

    return components;
}

function toMetaButton(btn: TemplateButton): Record<string, unknown> {
    if (btn.type === "QUICK_REPLY") {
        return { type: "QUICK_REPLY", text: btn.text };
    }
    if (btn.type === "URL") {
        return { type: "URL", text: btn.text, url: btn.url };
    }
    if (btn.type === "COPY_CODE") {
        return { type: "COPY_CODE", example: btn.example };
    }
    return {
        type: "PHONE_NUMBER",
        text: btn.text,
        phone_number: btn.phoneNumber,
    };
}

/**
 * Submete template à Meta (POST /{waba_id}/message_templates) e espelha localmente.
 */
export async function submitTemplateToMeta(
    admin: SupabaseClient,
    companyId: string,
    body: SubmitWhatsappTemplateBody
): Promise<
    | { ok: true; template: WhatsappTemplatePublic }
    | { ok: false; error: string; hint?: string; details?: unknown }
> {
    const creds = await loadActiveWaChannelCreds(admin, companyId);
    if ("error" in creds) {
        return {
            ok: false,
            error: creds.error,
            hint:
                creds.error === "missing_waba_id"
                    ? "Informe o WABA ID em Configurações → Canais."
                    : undefined,
        };
    }

    const placeholderCount = countPlaceholders(body.bodyText ?? "");
    const examples = body.exampleBodyValues ?? [];
    if (body.category !== "AUTHENTICATION" && placeholderCount > 0 && examples.length < placeholderCount) {
        return {
            ok: false,
            error: "example_values_required",
            hint: `Informe ${placeholderCount} valor(es) de exemplo para {{1}}…{{n}}.`,
        };
    }

    const components = buildMetaTemplateComponents(body);

    const url = `${GRAPH_BASE}/${encodeURIComponent(creds.wabaId)}/message_templates`;
    const res = await metaGraphPostJson(creds.wabaId, url, {
        accessToken: creds.accessToken,
        body: {
            name: body.name,
            language: body.language,
            category: body.category,
            components,
        },
    });

    if (!res.ok) {
        const parsed = parseMetaGraphError(res.json, res.status);
        console.warn("[whatsapp-templates] submit graph error", {
            status: res.status,
            code: parsed.code,
            error: parsed.error,
        });
        return {
            ok: false,
            error: parsed.error,
            details: res.json,
            hint: parsed.hint,
        };
    }

    const metaId = res.json?.id != null ? String(res.json.id) : null;
    const now = new Date().toISOString();

    const { data, error } = await admin
        .from("whatsapp_message_templates")
        .upsert(
            {
                company_id: companyId,
                waba_id: creds.wabaId,
                meta_template_id: metaId,
                name: body.name,
                language: body.language,
                category: body.category,
                status: "PENDING",
                components,
                rejection_reason: null,
                last_synced_at: now,
                updated_at: now,
            },
            { onConflict: "company_id,name,language" }
        )
        .select(
            "id, name, language, category, status, components, rejection_reason, meta_template_id, waba_id, last_synced_at"
        )
        .single();

    if (error || !data) {
        return { ok: false, error: error?.message ?? "local_upsert_failed" };
    }

    return { ok: true, template: toPublicTemplate(data) };
}
