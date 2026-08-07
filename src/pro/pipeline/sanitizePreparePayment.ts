import type { OrderDraft, PrepareDraftToolInput } from "@/src/types/contracts";
import { parsePaymentMethodFromUserText, parsePtMoneyInput } from "./paymentFromUserText";

/**
 * Impede a LLM de inventar `payment_method` / `change_for`.
 * Aceita pagamento só se já estava no draft ou o cliente citou no texto deste turno.
 */
export function sanitizePreparePaymentAgainstUserText(
    toolInput: PrepareDraftToolInput,
    userText: string,
    currentDraft: OrderDraft | null,
    opts?: { paymentFromUserText?: string | null }
): PrepareDraftToolInput {
    const draftPay = currentDraft?.paymentMethod ?? null;
    const draftChange = currentDraft?.changeFor ?? null;
    const fromText =
        opts?.paymentFromUserText?.trim() || parsePaymentMethodFromUserText(userText) || null;

    let paymentMethod = toolInput.paymentMethod;
    let changeFor = toolInput.changeFor;

    const allowedPay = fromText || draftPay;
    if (!allowedPay) {
        paymentMethod = null;
        changeFor = null;
    } else if (paymentMethod) {
        const toolNorm = String(paymentMethod).toLowerCase();
        const allowNorm = String(allowedPay).toLowerCase();
        if (!toolNorm.includes(allowNorm) && !allowNorm.includes(toolNorm.split(/[^a-z]/)[0] ?? "")) {
            paymentMethod = allowedPay;
        }
    } else {
        paymentMethod = allowedPay;
    }

    const payNorm = String(paymentMethod ?? "").toLowerCase();
    const isCash =
        payNorm === "cash" || payNorm.includes("dinheiro") || payNorm === "especie";
    if (!isCash) {
        changeFor = null;
    } else if (draftChange == null && changeFor != null) {
        /** Troco só se o cliente digitou valor monetário neste turno (não inventado pela LLM). */
        const spoken = parsePtMoneyInput(userText);
        changeFor = spoken != null ? spoken : null;
    }

    return {
        ...toolInput,
        paymentMethod: paymentMethod ?? null,
        changeFor: changeFor ?? null,
    };
}
