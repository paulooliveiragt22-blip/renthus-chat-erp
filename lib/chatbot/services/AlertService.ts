/**
 * lib/chatbot/services/AlertService.ts
 *
 * Registra alertas de fallback do parser em uma tabela Supabase dedicada.
 * Disparado quando o nível 2 ou 3 é acionado (Claude falhou ou produziu baixa confiança).
 *
 * Tabela: parser_alerts
 *   id uuid PK
 *   company_id uuid FK companies
 *   thread_id  uuid FK whatsapp_threads (nullable)
 *   level      integer  -- 2 = regex assumiu, 3 = assistido ativado
 *   input_text text
 *   error_hint text     -- mensagem de erro do parser que falhou
 *   created_at timestamptz
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AlertPayload {
    companyId: string;
    threadId: string;
    level: 2 | 3;
    inputText: string;
    errorHint?: string | null;
}

export async function alertParserFallback(
    admin: SupabaseClient,
    payload: AlertPayload
): Promise<void> {
    try {
        await admin.from("parser_alerts").insert({
            company_id: payload.companyId,
            thread_id:  payload.threadId,
            level:      payload.level,
            input_text: payload.inputText,
            error_hint: payload.errorHint ?? null,
        });
    } catch (err) {
        // Alertas nunca devem quebrar o fluxo principal
        console.error("[AlertService] failed to insert alert:", (err as any)?.message);
    }
}
