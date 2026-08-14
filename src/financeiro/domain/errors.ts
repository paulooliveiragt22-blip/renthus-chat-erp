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
