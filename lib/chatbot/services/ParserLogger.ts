/**
 * lib/chatbot/services/ParserLogger.ts
 *
 * Registra resultados do parser em bot_logs com as colunas:
 *   parser_level, fallback_used, response_time_ms,
 *   tokens_input, tokens_output, cost_usd, error, intent
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// Custo por milhão de tokens do Claude Haiku (referência 2025)
const HAIKU_COST_INPUT_PER_M  = 0.80;  // USD
const HAIKU_COST_OUTPUT_PER_M = 4.00;  // USD

export interface ParserLogEntry {
    companyId: string;
    threadId: string;
    /** waId da Meta (wamid.Hxxx) — salvo em prompt.wa_message_id para referência, não como FK */
    waMessageId: string;
    input: string;
    parserLevel: 1 | 2 | 3;
    fallbackUsed: boolean;
    responseTimeMs: number;
    action: string;
    confidence?: number | null;
    intent?: string | null;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    errorHint?: string | null;
}

export function estimateCostUsd(tokensInput: number, tokensOutput: number): number {
    return (
        (tokensInput  / 1_000_000) * HAIKU_COST_INPUT_PER_M +
        (tokensOutput / 1_000_000) * HAIKU_COST_OUTPUT_PER_M
    );
}

export async function logParserResult(
    admin: SupabaseClient,
    entry: ParserLogEntry
): Promise<void> {
    try {
        const costUsd =
            entry.tokensInput != null && entry.tokensOutput != null
                ? estimateCostUsd(entry.tokensInput, entry.tokensOutput)
                : null;

        await admin.from("bot_logs").insert({
            company_id:       entry.companyId,
            thread_id:        entry.threadId,
            direction:        "decision",
            intent_key:       entry.intent ?? entry.action,
            confidence:       entry.confidence ?? null,
            model_provider:   entry.parserLevel === 1 ? "anthropic" : "regex",
            model_name:       entry.parserLevel === 1 ? "claude-haiku-4-5-20251001" : null,
            prompt:           {
                input:          entry.input,
                wa_message_id:  entry.waMessageId,
                action:         entry.action,
            },
            parser_level:     entry.parserLevel,
            fallback_used:    entry.fallbackUsed,
            response_time_ms: entry.responseTimeMs,
            tokens_input:     entry.tokensInput  ?? null,
            tokens_output:    entry.tokensOutput ?? null,
            cost_usd:         costUsd,
            error_hint:       entry.errorHint    ?? null,
        });
    } catch (err) {
        // Logging must never break the main flow
        console.error("[ParserLogger] failed to log:", (err as any)?.message);
    }
}
