/**
 * Sinais determinísticos de pagamento/troco a partir do texto do cliente.
 * Não é “segundo cérebro”: só libera o que o prepare pode gravar (anti-alucinação da LLM).
 */

import type { PaymentMethod } from "@/src/types/contracts";

function norm(text: string): string {
    return String(text ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

/**
 * Valor monetário puro (troco). Rejeita frases com produto (“tem coca 2l?” → não é R$ 2).
 */
export function parsePtMoneyInput(text: string): number | null {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 32) return null;

    const flat = norm(raw);
    const withoutMoneyWords = flat
        .replaceAll(/\b(reais?|rs|troco|para|pra|de|no|valor)\b/gu, " ")
        .replaceAll(/r\s*\$/gu, " ")
        .replaceAll(/[^\p{L}]/gu, "");
    if (withoutMoneyWords.length > 0) return null;

    const only = raw.replaceAll(/[^\d,.\s]/g, "").trim();
    if (!only) return null;
    const normalized = only.replaceAll(/\s+/g, "").replaceAll(".", "").replace(",", ".");
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100) / 100;
}

/** Texto claramente não é valor de troco (produto, FAQ, pedido). */
export function looksLikeNonMoneyWhileAwaitingChange(text: string): boolean {
    const t = norm(text);
    if (!t) return false;
    if (parsePtMoneyInput(text) != null) return false;
    if (/\b(tem|quero|vende|coca|pedido|pix|cartao|endereco|sim|nao|ok)\b/u.test(t)) return true;
    if (t.length > 24) return true;
    return false;
}

/**
 * Pagamento explícito no texto do cliente (palavra-chave).
 * Usado no sanitize do prepare — substitui o antigo `paymentFromExtract`.
 */
export function parsePaymentMethodFromUserText(text: string): PaymentMethod | null {
    const t = norm(text);
    if (!t) return null;
    if (/\bpix\b/u.test(t)) return "pix";
    if (/\b(cartao|card|credito|debito)\b/u.test(t)) return "card";
    if (/\b(dinheiro|cash|especie)\b/u.test(t)) return "cash";
    return null;
}
