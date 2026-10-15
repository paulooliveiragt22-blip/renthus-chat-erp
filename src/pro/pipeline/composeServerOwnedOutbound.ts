import type { OutboundMessage } from "@/src/types/contracts";
import {
    HOLDING_REPLY_FALLBACK_PT,
    replaceHoldingOnlyReply,
} from "./holdingReply";

export function isServerCardMessage(message: OutboundMessage): boolean {
    return message.kind === "buttons" || message.kind === "cta_url";
}

/**
 * Turno com cartão do servidor (botão ou CTA que não veio do modelo): fica só
 * o que o servidor montou. Sem cartão, a prosa do modelo permanece; frase de
 * espera sem item novo vira a pergunta de produto.
 *
 * O cartão de endereço é anexado depois do checkout. A mesma função roda de
 * novo nesse ponto, com o mesmo conjunto de bolhas do modelo.
 */
export function composeServerOwnedOutbound(input: {
    messages: readonly OutboundMessage[];
    /** Bolhas emitidas pelo modelo neste turno (identidade de objeto). */
    modelMessages?: ReadonlySet<OutboundMessage>;
    replaceUnfulfilledHolding?: boolean;
}): OutboundMessage[] {
    const modelMessages = input.modelMessages ?? new Set<OutboundMessage>();
    const serverOwns = input.messages.some(
        (message) => isServerCardMessage(message) && !modelMessages.has(message)
    );
    if (serverOwns) {
        return input.messages.filter((message) => {
            if (modelMessages.has(message)) return false;
            if (
                message.kind === "text" &&
                (message.text ?? "").trim() === HOLDING_REPLY_FALLBACK_PT
            ) {
                return false;
            }
            return true;
        });
    }
    if (input.replaceUnfulfilledHolding) {
        return replaceHoldingOnlyReply(input.messages, { allowPrice: true });
    }
    return [...input.messages];
}
