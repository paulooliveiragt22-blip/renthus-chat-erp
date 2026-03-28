/**
 * lib/whatsapp/send.ts
 *
 * Envia mensagem de texto simples via Meta WhatsApp Cloud API.
 *
 * Variáveis de ambiente necessárias:
 *   WHATSAPP_TOKEN           — Bearer token da Meta
 *   WHATSAPP_PHONE_NUMBER_ID — ID do número cadastrado no Meta Business
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

/**
 * Credenciais por empresa.
 * Quando não fornecido, as funções caem para as variáveis de ambiente globais.
 */
export interface WaConfig {
    phoneNumberId: string;
    accessToken:   string;
}

/**
 * Garante que números brasileiros tenham o nono dígito.
 *
 * Números móveis BR chegam sem '+' e às vezes sem o 9:
 *   556692285005  (12 dígitos) → 5566992285005  (13 dígitos)
 *   5566992285005 (13 dígitos) → inalterado
 *
 * Regra: 55 + DDD (2) + 8 dígitos → inserir '9' após o DDD.
 * Qualquer outro formato passa sem alteração.
 */
function normalizeBrazilianNumber(raw: string): string {
    const digits = raw.replace(/^\+/, "").trim();

    // Número BR sem nono dígito: 55 + 2 DDD + 8 número = 12 dígitos
    if (/^55\d{10}$/.test(digits)) {
        const ddd    = digits.slice(2, 4);  // ex: "66"
        const number = digits.slice(4);     // ex: "92285005"
        return `55${ddd}9${number}`;        // ex: "5566992285005"
    }

    return digits;
}

export async function sendWhatsAppMessage(
    to: string,
    text: string,
    config?: WaConfig
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const token         = config?.accessToken   ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
        console.error("[send] WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados");
        return { ok: false, error: "missing_env_vars" };
    }

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const toNormalized = normalizeBrazilianNumber(to);
    console.log("[send] enviando para:", toNormalized, "| phoneNumberId:", phoneNumberId);

    const body = {
        messaging_product: "whatsapp",
        to:                toNormalized,
        type:              "text",
        text:              { body: text },
    };

    try {
        const res = await fetch(url, {
            method:  "POST",
            headers: {
                Authorization:  `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => ({})) as any;

        if (!res.ok) {
            console.error("[send] Meta API error:", JSON.stringify(json));
            return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
        }

        const messageId: string | undefined = json?.messages?.[0]?.id;
        return { ok: true, messageId };

    } catch (err: any) {
        console.error("[send] fetch error:", err?.message ?? err);
        return { ok: false, error: String(err?.message ?? err) };
    }
}

/**
 * Dispara um WhatsApp Flow para o usuário.
 *
 * Requer:
 *   WHATSAPP_FLOW_ID          — ID do Flow registrado no Meta Business Manager
 *   WHATSAPP_TOKEN            — Bearer token da Meta
 *   WHATSAPP_PHONE_NUMBER_ID  — phone_number_id do número cadastrado
 *
 * O flowToken identifica a sessão e é passado de volta ao endpoint /api/whatsapp/flows
 * via action INIT/data_exchange. Formato recomendado: "${threadId}|${companyId}".
 */
export async function sendFlowMessage(
    to:     string,
    params: {
        flowToken:  string;
        bodyText:   string;
        ctaLabel:   string;
        mode?:      "published" | "draft";
        /** Flow ID da empresa (sobrepõe WHATSAPP_FLOW_ID env var) */
        flowId?:    string;
    },
    config?: WaConfig
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const token         = config?.accessToken   ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    const flowId        = params.flowId ?? process.env.WHATSAPP_FLOW_ID;

    if (!token || !phoneNumberId) {
        console.error("[send] WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados");
        return { ok: false, error: "missing_env_vars" };
    }
    if (!flowId) {
        console.error("[send] WHATSAPP_FLOW_ID não configurado");
        return { ok: false, error: "missing_flow_id" };
    }

    const toNormalized = normalizeBrazilianNumber(to);
    const url          = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const body = {
        messaging_product: "whatsapp",
        to:                toNormalized,
        type:              "interactive",
        interactive: {
            type: "flow",
            body: { text: params.bodyText.slice(0, 1024) },
            action: {
                name:       "flow",
                parameters: {
                    flow_message_version: "3",
                    flow_id:              flowId,
                    flow_token:           params.flowToken,
                    flow_action:          "data_exchange",
                    mode:                 params.mode ?? "published",
                    flow_cta:             params.ctaLabel.slice(0, 20),
                },
            },
        },
    };

    try {
        const res = await fetch(url, {
            method:  "POST",
            headers: {
                Authorization:  `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => ({})) as any;

        if (!res.ok) {
            console.error("[send] Meta API error (flow):", JSON.stringify(json));
            return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
        }

        return { ok: true, messageId: json?.messages?.[0]?.id };

    } catch (err: any) {
        console.error("[send] fetch error (flow):", err?.message ?? err);
        return { ok: false, error: String(err?.message ?? err) };
    }
}

/**
 * Envia mensagem interativa com até 3 botões de resposta rápida (reply_button).
 * Título de cada botão: máx 20 chars.
 */
export async function sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    config?: WaConfig
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const token         = config?.accessToken   ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
        console.error("[send] WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados");
        return { ok: false, error: "missing_env_vars" };
    }

    const toNormalized = normalizeBrazilianNumber(to);
    const url          = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const body = {
        messaging_product: "whatsapp",
        to:                toNormalized,
        type:              "interactive",
        interactive: {
            type: "button",
            body: { text: bodyText.slice(0, 1024) },
            action: {
                buttons: buttons.slice(0, 3).map((b) => ({
                    type:  "reply",
                    reply: {
                        id:    b.id.slice(0, 256),
                        title: b.title.slice(0, 20),
                    },
                })),
            },
        },
    };

    try {
        const res = await fetch(url, {
            method:  "POST",
            headers: {
                Authorization:  `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => ({})) as any;

        if (!res.ok) {
            console.error("[send] Meta API error (buttons):", JSON.stringify(json));
            return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
        }

        return { ok: true, messageId: json?.messages?.[0]?.id };

    } catch (err: any) {
        console.error("[send] fetch error (buttons):", err?.message ?? err);
        return { ok: false, error: String(err?.message ?? err) };
    }
}

/**
 * Envia mensagem interativa de lista (list_message).
 * Até 10 linhas por seção; título de linha: máx 24 chars.
 */
export async function sendListMessage(
    to: string,
    bodyText: string,
    buttonLabel: string,
    rows: Array<{ id: string; title: string; description?: string }>,
    sectionTitle?: string,
    config?: WaConfig
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const token         = config?.accessToken   ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
        console.error("[send] WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados");
        return { ok: false, error: "missing_env_vars" };
    }

    const toNormalized = normalizeBrazilianNumber(to);
    const url          = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const body = {
        messaging_product: "whatsapp",
        to:                toNormalized,
        type:              "interactive",
        interactive: {
            type: "list",
            body: { text: bodyText.slice(0, 1024) },
            action: {
                button:   buttonLabel.slice(0, 20),
                sections: [{
                    title: (sectionTitle ?? "Opções").slice(0, 24),
                    rows:  rows.slice(0, 10).map((r) => ({
                        id:    r.id.slice(0, 200),
                        title: r.title.slice(0, 24),
                        ...(r.description ? { description: r.description.slice(0, 72) } : {}),
                    })),
                }],
            },
        },
    };

    try {
        const res = await fetch(url, {
            method:  "POST",
            headers: {
                Authorization:  `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => ({})) as any;

        if (!res.ok) {
            console.error("[send] Meta API error (list):", JSON.stringify(json));
            return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
        }

        return { ok: true, messageId: json?.messages?.[0]?.id };

    } catch (err: any) {
        console.error("[send] fetch error (list):", err?.message ?? err);
        return { ok: false, error: String(err?.message ?? err) };
    }
}

/**
 * Envia mensagem interativa de lista com múltiplas seções.
 * Até 10 seções; cada seção até 10 linhas; title da linha: máx 24 chars.
 */
export async function sendListMessageSections(
    to: string,
    bodyText: string,
    buttonLabel: string,
    sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
    }>,
    config?: WaConfig
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const token         = config?.accessToken   ?? process.env.WHATSAPP_TOKEN;
    const phoneNumberId = config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
        console.error("[send] WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados");
        return { ok: false, error: "missing_env_vars" };
    }

    const toNormalized = normalizeBrazilianNumber(to);
    const url          = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const body = {
        messaging_product: "whatsapp",
        to:                toNormalized,
        type:              "interactive",
        interactive: {
            type: "list",
            body: { text: bodyText.slice(0, 1024) },
            action: {
                button:   buttonLabel.slice(0, 20),
                sections: sections.slice(0, 10).map((s) => ({
                    title: s.title.slice(0, 24),
                    rows:  s.rows.slice(0, 10).map((r) => ({
                        id:    r.id.slice(0, 200),
                        title: r.title.slice(0, 24),
                        ...(r.description ? { description: r.description.slice(0, 72) } : {}),
                    })),
                })),
            },
        },
    };

    try {
        const res = await fetch(url, {
            method:  "POST",
            headers: {
                Authorization:  `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => ({})) as any;

        if (!res.ok) {
            console.error("[send] Meta API error (list-sections):", JSON.stringify(json));
            return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
        }

        return { ok: true, messageId: json?.messages?.[0]?.id };

    } catch (err: any) {
        console.error("[send] fetch error (list-sections):", err?.message ?? err);
        return { ok: false, error: String(err?.message ?? err) };
    }
}
