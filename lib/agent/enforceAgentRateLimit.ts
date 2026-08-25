import { NextResponse } from "next/server";
import {
    checkRateLimit,
    rateLimitExceededResponse,
    RATE_LIMIT_WINDOW_MS,
} from "@/lib/security/rateLimit";

/** Poll frequente do Electron — 1/s de média com folga. */
export const AGENT_POLL_LIMIT = 60;
/** Reserve / complete / fail no mesmo minuto. */
export const AGENT_JOB_MUTATION_LIMIT = 120;
/** Heartbeat típico 10–30s → teto 12/min. */
export const AGENT_HEARTBEAT_LIMIT = 12;

/**
 * Rate limit pós-auth por `print_agents.id` (não por IP — NAT compartilhado).
 * Retorna 429 ou `null`.
 */
export function enforceAgentRateLimit(
    agentId: string,
    op: "poll" | "reserve" | "complete" | "fail" | "heartbeat" | "auth",
    limit: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS
): NextResponse | null {
    const rl = checkRateLimit(`agent:${op}:${agentId}`, limit, windowMs);
    if (rl.allowed) return null;
    return rateLimitExceededResponse(rl, {
        error: "rate_limit_exceeded",
        retry_after_sec: rl.retryAfterSeconds,
    });
}
