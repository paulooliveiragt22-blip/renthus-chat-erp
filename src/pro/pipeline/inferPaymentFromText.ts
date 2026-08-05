import type { PaymentMethod } from "@/src/types/contracts";

/**
 * Extrai forma de pagamento do texto do cliente (1ª mensagem ou revisão).
 */
export function inferPaymentMethodFromText(text: string): PaymentMethod | null {
    const flat = text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
    if (!flat) return null;

    if (/\b(pix|pic\s*pay)\b/u.test(flat)) return "pix";
    if (/\b(dinheiro|especie|em\s+especie|cash)\b/u.test(flat)) return "cash";
    if (/\b(cartao|card|credito|debito|maquininha)\b/u.test(flat)) return "card";
    if (/\bpaga(?:ndo|mento)?\s+(no|em)\s+pix\b/u.test(flat)) return "pix";
    return null;
}

export function inferUseSavedAddressFromText(text: string): boolean {
    const flat = text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
    return (
        /\bmesmo\s+endereco\b/u.test(flat) ||
        /\bendereco\s+de\s+sempre\b/u.test(flat) ||
        /\bendereco\s+salvo\b/u.test(flat) ||
        /\b(manda|entrega)\s+(no|no\s+meu)\s+endereco\b/u.test(flat)
    );
}
