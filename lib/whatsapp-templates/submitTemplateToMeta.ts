import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { metaGraphPostJson } from "@/lib/whatsapp/metaGraphFetch";
import type { SubmitWhatsappTemplateBody } from "@/src/domain/contracts/whatsappTemplates";
import {
    loadActiveWaChannelCreds,
    toPublicTemplate,
} from "@/lib/whatsapp-templates/syncTemplatesFromMeta";
import type { WhatsappTemplatePublic } from "@/src/domain/contracts/whatsappTemplates";

const GRAPH_BASE =
    process.env.WHATSAPP_BASE_URL?.replace(/\/$/, "") ||
    "https://graph.facebook.com/v20.0";

function countBodyPlaceholders(bodyText: string): number {
    const matches = bodyText.match(/\{\{\d+\}\}/g);
    return matches ? new Set(matches).size : 0;
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

    const placeholderCount = countBodyPlaceholders(body.bodyText);
    const examples = body.exampleBodyValues ?? [];
    if (placeholderCount > 0 && examples.length < placeholderCount) {
        return {
            ok: false,
            error: "example_values_required",
            hint: `Informe ${placeholderCount} valor(es) de exemplo para {{1}}…{{n}}.`,
        };
    }

    const components: Array<Record<string, unknown>> = [
        {
            type: "BODY",
            text: body.bodyText,
            ...(placeholderCount > 0
                ? {
                      example: {
                          body_text: [examples.slice(0, placeholderCount)],
                      },
                  }
                : {}),
        },
    ];
    if (body.footerText?.trim()) {
        components.push({ type: "FOOTER", text: body.footerText.trim() });
    }

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
        const errObj = res.json?.error as { message?: string } | undefined;
        return {
            ok: false,
            error: errObj?.message ?? `graph_http_${res.status}`,
            details: res.json,
            hint: "Permissão whatsapp_business_management / App Review pode estar pendente.",
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
