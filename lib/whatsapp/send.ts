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

export async function sendWhatsAppMessage(
    to: string,
    text: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const token         = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
        console.error("[send] WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados");
        return { ok: false, error: "missing_env_vars" };
    }

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const body = {
        messaging_product: "whatsapp",
        to:                to.replace(/^\+/, ""), // Meta espera sem o '+'
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
