/**
 * Confirmação / cancelamento estruturados (bot PRO + HITL atendente→cliente).
 * Só IDs de `interactive.button_reply.id` do WhatsApp — nunca prosa
 * (“sim”, “ok”, “CONFIRMAR”, “1”). Mutação financeira só via clique.
 *
 * Contrato único (ADR-0005 C1): `detectStructuredCheckoutAction`.
 */

const CONFIRMATION_BUTTON_IDS = new Set([
    "pro_confirm_order",
    "btn_confirm_order",
    "btn_confirmar",
]);

const CANCEL_BUTTON_IDS = new Set([
    "pro_cancel_order",
    "btn_cancel_order",
]);

export type StructuredCheckoutAction = "confirm" | "cancel";

function normalizeButtonPayload(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

/** Confirmar ou cancelar pedido por ID de botão; `null` = prosa / outro inbound. */
export function detectStructuredCheckoutAction(text: string): StructuredCheckoutAction | null {
    const raw = text.trim();
    if (!raw || raw.length > 96) return null;
    const normalized = normalizeButtonPayload(raw);
    if (CONFIRMATION_BUTTON_IDS.has(normalized)) return "confirm";
    if (CANCEL_BUTTON_IDS.has(normalized)) return "cancel";
    return null;
}

export function isExplicitOrderConfirmation(text: string): boolean {
    return detectStructuredCheckoutAction(text) === "confirm";
}

export function isExplicitOrderCancellation(text: string): boolean {
    return detectStructuredCheckoutAction(text) === "cancel";
}

/**
 * Prosa que tenta confirmar (“sim”, “pode fechar”) sem ser o botão Confirmar.
 * Não é revisão de itens — o gate do resumo reenvia o card.
 */
export function looksLikeWeakConfirmProse(text: string): boolean {
    const raw = text.trim();
    if (!raw || raw.length > 48) return false;
    if (detectStructuredCheckoutAction(raw) != null) return false;

    const normalized = normalizeButtonPayload(raw);
    if (!normalized) return false;
    if (
        /^(sim+|ok+|okay|pode|fechamos|fechar|confirmar|confirma|isso|ta|beleza|blz|uhum|yes|certo|perfeito|fechado|bora)$/u.test(
            normalized
        )
    ) {
        return true;
    }
    if (/^(isso\s+mesmo|ta\s+bom|ok\s+pode|ok\s+fechar|ok\s+confirmar)$/u.test(normalized)) {
        return true;
    }
    if (
        /^(sim\s+|ok\s+|okay\s+)?(pode\s+)?(fechar|confirmar|confirma)(\s+(o\s+)?pedido)?$/u.test(
            normalized
        )
    ) {
        return true;
    }
    if (/^(sim\s+)?pode(\s+(fechar|confirmar)(\s+(o\s+)?pedido)?)?$/u.test(normalized)) {
        return true;
    }
    if (/^(quero\s+)(fechar|confirmar)(\s+(o\s+)?pedido)?$/u.test(normalized)) {
        return true;
    }
    return false;
}

/** Botões Meta no envio HITL (`send-confirmation`) e alinhados ao PRO. */
export const HITL_ORDER_CONFIRM_BUTTONS: ReadonlyArray<{ id: string; title: string }> = [
    { id: "pro_confirm_order", title: "Confirmar" },
    { id: "pro_cancel_order", title: "Cancelar" },
];

/**
 * Texto livre na confirmação que parece revisão/novo pedido (não botão Confirmar).
 * Usado para sair do hold de `pro_awaiting_confirmation` e deixar a IA/coleta agir.
 */
export function looksLikeCheckoutRevisionText(text: string): boolean {
    const raw = text.trim();
    if (!raw || raw.length < 4) return false;
    if (detectStructuredCheckoutAction(raw) != null) return false;
    if (looksLikeWeakConfirmProse(raw)) return false;

    const normalized = raw
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();

    if (/^(corrigir|alterar|adicionar|editar|trocar|mudar)\b/u.test(normalized)) return true;
    if (/\b(quero|queria|manda|pode|preciso)\b/u.test(normalized) && normalized.length >= 12) {
        return true;
    }
    if (
        /\b(caixa|unidades?|long\s*neck|cerveja|hamburguer|salgadinho|refrigerante|pix|cartao|dinheiro)\b/u.test(
            normalized
        )
    ) {
        return true;
    }
    // Pedido multi-item típico (“uma X e um Y”)
    if (/\be\s+(um|uma|uns|umas|\d+)\b/u.test(normalized) && normalized.length >= 16) return true;
    return false;
}
