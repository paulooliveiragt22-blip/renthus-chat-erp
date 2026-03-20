/**
 * lib/chatbot/services/ParserLogger.ts
 *
 * Registra resultados do parser em bot_logs com as colunas:
 *   parser_level, fallback_used, response_time_ms
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
}

export async function logParserResult(
    admin: SupabaseClient,
    entry: ParserLogEntry
): Promise<void> {
    try {
        await admin.from("bot_logs").insert({
            company_id:       entry.companyId,
            thread_id:        entry.threadId,
            // whatsapp_message_id omitido — só temos o waId string, não o UUID do banco
            direction:        "decision",
            intent_key:       entry.action,
            confidence:       entry.confidence ?? null,
            model_provider:   entry.parserLevel === 1 ? "anthropic" : "regex",
            model_name:       entry.parserLevel === 1 ? "claude-haiku-4-5-20251001" : null,
            prompt:           { input: entry.input, wa_message_id: entry.waMessageId },
            parser_level:     entry.parserLevel,
            fallback_used:    entry.fallbackUsed,
            response_time_ms: entry.responseTimeMs,
        });
    } catch (err) {
        // Logging must never break the main flow
        console.error("[ParserLogger] failed to log:", (err as any)?.message);
    }
}
