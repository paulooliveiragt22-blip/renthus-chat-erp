/**
 * lib/billing/sendBillingNotification.ts
 *
 * Envia avisos de cobrança / operação via WhatsApp Cloud API.
 * Credenciais vêm do canal ativo da empresa (`companyId`); se não houver token,
 * tenta `PLATFORM_WHATSAPP_COMPANY_ID` (empresa “Renthus” com canal no superadmin);
 * por último usa `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (legado).
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";

const GRAPH_API_BASE = process.env.WHATSAPP_BASE_URL ?? "https://graph.facebook.com/v20.0";

type SenderConfig = { token: string; phoneNumberId: string };

async function resolveBillingSender(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string
): Promise<SenderConfig | null> {
    const load = async (cid: string): Promise<SenderConfig | null> => {
        const { data: ch } = await admin
            .from("whatsapp_channels")
            .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
            .eq("company_id", cid)
            .eq("status", "active")
            .maybeSingle();
        if (!ch) return null;
        const token         = resolveChannelAccessToken(ch);
        const phoneNumberId = (ch.from_identifier ?? "").trim();
        if (token && phoneNumberId) return { token, phoneNumberId };
        return null;
    };

    let cfg = await load(companyId);
    if (cfg) return cfg;

    const platform = process.env.PLATFORM_WHATSAPP_COMPANY_ID?.trim();
    if (platform && platform !== companyId) {
        cfg = await load(platform);
        if (cfg) return cfg;
    }

    const token         = process.env.WHATSAPP_TOKEN?.trim() ?? "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
    if (token && phoneNumberId) return { token, phoneNumberId };

    return null;
}

function normalizeBrazilianNumber(raw: string): string {
    const digits = raw.replaceAll(/^\+/g, "").trim();
    if (/^55\d{10}$/.test(digits)) {
        const ddd    = digits.slice(2, 4);
        const number = digits.slice(4);
        return `55${ddd}9${number}`;
    }
    return digits;
}

/**
 * @param companyId Empresa cujo canal Meta será usado para enviar (ou fallback plataforma / env).
 * @param to Destino E.164 sem + ou com + (normalizado).
 */
export async function sendBillingNotification(
    companyId: string,
    to: string,
    text: string
): Promise<{ ok: boolean; error?: string }> {
    const admin = createAdminClient();
    const cfg   = await resolveBillingSender(admin, companyId);

    if (!cfg) {
        console.error(
            "[billing-notify] Sem credenciais de envio: configure canal WhatsApp da empresa, " +
                "PLATFORM_WHATSAPP_COMPANY_ID ou WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID."
        );
        return { ok: false, error: "missing_sender_credentials" };
    }

    const toNormalized = normalizeBrazilianNumber(to);
    const url          = `${GRAPH_API_BASE.replace(/\/$/, "")}/${cfg.phoneNumberId}/messages`;

    try {
        const res = await fetch(url, {
            method:  "POST",
            headers: {
                Authorization:  `Bearer ${cfg.token}`,
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
