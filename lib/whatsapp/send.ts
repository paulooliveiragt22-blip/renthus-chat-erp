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
    text: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const token         = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

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
