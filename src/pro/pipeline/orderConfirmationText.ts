/**
 * Confirmação forte de pedido no PRO: só IDs estruturados de botão (HITL).
 * Texto livre (“sim”, “ok”) não finaliza — vai para o agent loop / revisão.
 * Contexto: só é chamado quando `step === pro_awaiting_confirmation`.
 */

const CONFIRMATION_BUTTON_IDS = new Set([
    "confirmar",
    "confirmar_pedido",
    "confirm_order",
    "pro_confirm_order",
    "btn_confirm_order",
    "btn_confirmar",
]);

export function isExplicitOrderConfirmation(text: string): boolean {
    const raw = text.trim();
    if (!raw || raw.length > 96) return false;

    const normalized = raw
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();

    return CONFIRMATION_BUTTON_IDS.has(normalized);
}

/**
 * Texto livre na confirmação que parece revisão/novo pedido (não botão Confirmar).
 * Usado para sair do hold de `pro_awaiting_confirmation` e deixar a IA/coleta agir.
 */
export function looksLikeCheckoutRevisionText(text: string): boolean {
    const raw = text.trim();
    if (!raw || raw.length < 4) return false;
    if (isExplicitOrderConfirmation(raw)) return false;

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
