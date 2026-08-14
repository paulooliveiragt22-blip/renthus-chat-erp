import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { mapFinanceRpcError } from "@/src/financeiro/domain/errors";

const WINDOW_MS = 60_000;
const LIMIT = 30;

export function enforceFinanceWriteRateLimit(companyId: string, op: string): NextResponse | null {
    const rl = checkRateLimit(`financeiro:${op}:${companyId}`, LIMIT, WINDOW_MS);
    if (rl.allowed) return null;
    return NextResponse.json(
        { error: "rate_limit_exceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
}

export function financeRpcFailure(message: string): NextResponse {
    const mapped = mapFinanceRpcError(message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
}
