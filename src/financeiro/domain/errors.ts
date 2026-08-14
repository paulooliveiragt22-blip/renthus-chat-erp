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
    if (/idempotency_key_required/i.test(msg)) {
        return { status: 400, error: "idempotency_key_required" };
    }
    if (/rate_limit/i.test(msg)) {
        return { status: 429, error: "rate_limit_exceeded" };
    }
    return { status: 500, error: msg };
}
