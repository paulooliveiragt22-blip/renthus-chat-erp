import type { OrderDraft, PrepareDraftToolInput } from "@/src/types/contracts";

/**
 * Impede a LLM de inventar `payment_method` / `change_for`.
 * Aceita pagamento só se já estava no draft ou veio da extração deste turno.
 */
export function sanitizePreparePaymentAgainstUserText(
    toolInput: PrepareDraftToolInput,
    _userText: string,
    currentDraft: OrderDraft | null,
    opts?: { paymentFromExtract?: string | null }
): PrepareDraftToolInput {
    const draftPay = currentDraft?.paymentMethod ?? null;
    const draftChange = currentDraft?.changeFor ?? null;
    const extractPay = opts?.paymentFromExtract?.trim() || null;

    let paymentMethod = toolInput.paymentMethod;
    let changeFor = toolInput.changeFor;

    const allowedPay = extractPay || draftPay;
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
    } else if (draftChange == null && changeFor != null && !extractPay) {
        /** Troco inventado sem o cliente falar de dinheiro nesta extração. */
        changeFor = null;
    }

    return {
        ...toolInput,
        paymentMethod: paymentMethod ?? null,
        changeFor: changeFor ?? null,
    };
}
