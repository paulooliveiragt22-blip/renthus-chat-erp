import { NextResponse } from "next/server";

const CLIENT_MARKERS = [
    "not_open",
    "not_released",
    "not_found",
    "not_free",
    "disabled",
    "already_open",
    "payments_mismatch",
    "payments_required",
    "payment_not_allowed",
    "payment_amount_invalid",
    "cart_empty",
    "sem_estoque",
    "cash_register",
    "combo_sem_estoque",
    "preco_indisponivel",
];

export function mesaRpcError(error: { message?: string }, fallback: string): NextResponse {
    const msg = error.message || fallback;
    const status = CLIENT_MARKERS.some((m) => msg.includes(m)) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
}
