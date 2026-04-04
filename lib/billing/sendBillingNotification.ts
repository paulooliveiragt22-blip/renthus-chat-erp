/**
 * lib/billing/sendBillingNotification.ts
 *
 * Envia avisos de cobrança via WhatsApp usando o número da RENTHUS
 * (não o número do disk bebidas cliente).
 *
 * Variáveis de ambiente necessárias:
 *   WHATSAPP_TOKEN          — Bearer token da Meta (mesmo do sistema)
 *   WHATSAPP_PHONE_NUMBER_ID — Phone Number ID cadastrado no Meta Business (Renthus)
 */

import "server-only";

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

function normalizeBrazilianNumber(raw: string): string {
    const digits = raw.replaceAll(/^\+/g, "").trim();
    if (/^55\d{10}$/.test(digits)) {
        const ddd    = digits.slice(2, 4);
        const number = digits.slice(4);
        return `55${ddd}9${number}`;
    }
    return digits;
}

export async function sendBillingNotification(
    to: string,
    text: string
): Promise<{ ok: boolean; error?: string }> {
    const token         = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
        console.error(
            "[billing-notify] WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados"
        );
        return { ok: false, error: "missing_env_vars" };
    }

    const toNormalized = normalizeBrazilianNumber(to);
    const url          = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    try {
        const res = await fetch(url, {
            method:  "POST",
            headers: {
                Authorization:  `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to:                toNormalized,
                type:              "text",
                text:              { body: text },
            }),
        });

        const json = (await res.json().catch(() => ({}))) as any;

        if (!res.ok) {
            console.error("[billing-notify] Meta API error:", JSON.stringify(json));
            return { ok: false, error: json?.error?.message ?? `HTTP ${res.status}` };
        }

        return { ok: true };
    } catch (err: any) {
        console.error("[billing-notify] fetch error:", err?.message ?? err);
        return { ok: false, error: String(err?.message ?? err) };
    }
}

// ---------------------------------------------------------------------------
// Templates de mensagem por dia de atraso
// ---------------------------------------------------------------------------

export function buildOverdueMessage(
    daysOverdue: number,
    paymentUrl: string
): string | null {
    const link = paymentUrl ? `\n\n💳 Pague agora: ${paymentUrl}` : "";

    switch (daysOverdue) {
        case 1:
            return (
                "⚠️ *Aviso de cobrança — Renthus*\n\n" +
                "Sua mensalidade venceu hoje. Realize o pagamento para evitar o bloqueio do sistema." +
                link
            );
        case 3:
            return (
                "⚠️ *Aviso de cobrança — Renthus*\n\n" +
                "Sua mensalidade está em atraso há 3 dias. Faltam *2 dias* para o bloqueio automático do sistema." +
                link
            );
        case 5:
            return (
                "🔴 *Último aviso — Renthus*\n\n" +
                "Sua mensalidade está em atraso há 5 dias. O sistema será *bloqueado hoje à meia-noite* caso o pagamento não seja realizado." +
                link
            );
        default:
            return null; // Só envia nos dias 1, 3 e 5
    }
}
