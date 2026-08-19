import { normalizeBrPhone } from "./phone";

/** Texto pré-preenchido no wa.me — o bot responde com link `wm` curto (sem OTP). */
export const WA_ME_ORDERS_PREFILL = "Ver meus pedidos";

export function buildWaMeOrdersUrl(whatsappPhone: string): string | null {
    const raw = whatsappPhone.trim();
    if (!raw) return null;
    const norm = normalizeBrPhone(raw);
    if (!norm.ok) {
        const digits = raw.replace(/\D/g, "");
        if (digits.length < 10) return null;
        const intl = digits.startsWith("55") ? digits : `55${digits}`;
        return `https://wa.me/${intl}?text=${encodeURIComponent(WA_ME_ORDERS_PREFILL)}`;
    }
    return `https://wa.me/55${norm.digits}?text=${encodeURIComponent(WA_ME_ORDERS_PREFILL)}`;
}

function normalizeInboundText(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

/** Inbound WA após o cliente tocar no fallback wa.me do cardápio. */
export function isWaMeOrdersPrefill(text: string): boolean {
    return normalizeInboundText(text) === normalizeInboundText(WA_ME_ORDERS_PREFILL);
}
