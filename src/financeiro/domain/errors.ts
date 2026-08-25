export class FinanceError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly httpStatus: number = 400
    ) {
        super(message);
        this.name = "FinanceError";
    }
}

export function isPrazoForbidden(message: string): boolean {
    return /chatbot_prazo_forbidden/i.test(message);
}

/** Mapeia erro de RPC de dinheiro para HTTP. Retry idempotente não entra aqui (é 200). */
export function mapFinanceRpcError(message: string): { status: number; error: string } {
    const msg = message ?? "";
    if (/chatbot_prazo_forbidden/i.test(msg)) {
        return { status: 422, error: "chatbot_prazo_forbidden" };
    }
    if (/customer_required_for_prazo/i.test(msg)) {
        return { status: 422, error: "customer_required_for_prazo" };
    }
    if (/settlement_conflict/i.test(msg)) {
        return { status: 409, error: "settlement_conflict" };
    }
    if (/journal_already_reversed|journal_nothing_to_reverse/i.test(msg)) {
        return { status: 409, error: "journal_already_reversed" };
    }
    if (/cannot_reverse_reversal/i.test(msg)) {
        return { status: 409, error: "cannot_reverse_reversal" };
    }
    if (/journal_line_exceeds_remaining|journal_exceeds_liquid_remaining/i.test(msg)) {
        return { status: 422, error: "journal_line_exceeds_remaining" };
    }
    if (/liquid_line_not_selectable/i.test(msg)) {
        return { status: 422, error: "liquid_line_not_selectable" };
    }
    if (/partial_requires_items/i.test(msg)) {
        return { status: 400, error: "partial_requires_items" };
    }
    if (/prazo_partial_blocked/i.test(msg)) {
        return { status: 422, error: "prazo_partial_blocked" };
    }
    if (/order_item_not_found|order_item_qty_exceeds/i.test(msg)) {
        return { status: 422, error: "order_item_invalid" };
    }
    if (/rate_limit/i.test(msg)) {
        return { status: 429, error: "rate_limit_exceeded" };
    }
    return { status: 500, error: msg };
}
