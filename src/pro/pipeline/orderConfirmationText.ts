/**
 * Confirmação forte de pedido no PRO: só IDs estruturados de botão (HITL) —
 * eventos de `interactive.button_reply.id` do WhatsApp, nunca texto digitado.
 * Texto livre (“sim”, “ok”, “confirmar”) não finaliza — vai para o agent loop /
 * revisão; a IA responde normalmente e pode reforçar o botão Confirmar, mas só
 * o clique estruturado dispara a RPC de criar pedido (mutação financeira +
 * baixa de estoque é irreversível — não delegamos esse gatilho a NLU/regex).
 * Contexto: só é chamado quando `step === pro_awaiting_confirmation`.
 *
 * `confirmar` / `confirmar_pedido` / `confirm_order` eram aliases de tela nativa
 * antiga do WhatsApp — removidos daqui porque também casavam com texto puro
 * digitado pelo cliente. Único ID real que os botões do PRO enviam hoje:
 * `pro_confirm_order` (`checkoutPostProcess.ts`); `btn_confirm_order`/`btn_confirmar`
 * seguem como aliases de compatibilidade.
 */

const CONFIRMATION_BUTTON_IDS = new Set([
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
