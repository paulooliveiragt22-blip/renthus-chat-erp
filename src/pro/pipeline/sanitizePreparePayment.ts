import type { OrderDraft, PrepareDraftToolInput } from "@/src/types/contracts";
import {
    userTextMentionsChangeFor,
    userTextMentionsPayment,
} from "./paymentFromUserText";

/**
 * Impede a LLM de inventar `payment_method` / `change_for` quando o cliente
 * só confirmou endereço (“exatamente”) ou falou de produto (“tem coca 2l”).
 * Mantém pagamento já no draft atual.
 */
export function sanitizePreparePaymentAgainstUserText(
    toolInput: PrepareDraftToolInput,
    userText: string,
    currentDraft: OrderDraft | null
): PrepareDraftToolInput {
    const mentionedPay = userTextMentionsPayment(userText);
    const mentionedChange = userTextMentionsChangeFor(userText);
    const draftPay = currentDraft?.paymentMethod ?? null;
    const draftChange = currentDraft?.changeFor ?? null;

    let paymentMethod = toolInput.paymentMethod;
    let changeFor = toolInput.changeFor;

    if (!mentionedPay) {
        /** Sem menção → não aceitar pagamento novo da tool; merge reusa o draft. */
        paymentMethod = draftPay;
        if (!mentionedChange) changeFor = draftChange;
    }

    if (!mentionedChange && draftChange == null) {
        changeFor = null;
    }

    /** Troco só faz sentido com dinheiro. */
    const payNorm = String(paymentMethod ?? draftPay ?? "")
        .trim()
        .toLowerCase();
    const isCash =
        payNorm === "cash" || payNorm.includes("dinheiro") || payNorm === "especie";
    if (!isCash) changeFor = null;

    return {
        ...toolInput,
        paymentMethod: paymentMethod ?? null,
        changeFor: changeFor ?? null,
    };
}
