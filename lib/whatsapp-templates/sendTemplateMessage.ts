import "server-only";

import { metaGraphPostJson } from "@/lib/whatsapp/metaGraphFetch";
import type { WaConfig } from "@/lib/whatsapp/send";

const GRAPH_BASE =
    process.env.WHATSAPP_BASE_URL?.replace(/\/$/, "") ||
    "https://graph.facebook.com/v20.0";

export type SendTemplateParams = {
    toE164: string;
    templateName: string;
    languageCode: string;
    /** Valores posicionais para body {{1}}, {{2}}, … */
    bodyParameters?: string[];
    config: WaConfig;
};

/**
 * Envia mensagem type=template via Cloud API.
 */
export async function sendTemplateMessage(
    params: SendTemplateParams
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const to = params.toE164.replaceAll("+", "").trim();
    if (!params.config.accessToken || !params.config.phoneNumberId) {
        return { ok: false, error: "missing_wa_config" };
    }

    const components: Array<Record<string, unknown>> = [];
    if (params.bodyParameters?.length) {
        components.push({
            type: "body",
            parameters: params.bodyParameters.map((text) => ({
                type: "text",
                text,
            })),
        });
    }

    const url = `${GRAPH_BASE}/${params.config.phoneNumberId}/messages`;
    const res = await metaGraphPostJson(params.config.phoneNumberId, url, {
        accessToken: params.config.accessToken,
        body: {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: params.templateName,
                language: { code: params.languageCode },
                ...(components.length ? { components } : {}),
            },
        },
    });

    if (!res.ok) {
        const errObj = res.json?.error as { message?: string } | undefined;
        return { ok: false, error: errObj?.message ?? `HTTP ${res.status}` };
    }
    const messages = res.json?.messages as Array<{ id?: string }> | undefined;
    return { ok: true, messageId: messages?.[0]?.id };
}
