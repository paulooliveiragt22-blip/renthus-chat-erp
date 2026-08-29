import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

/** Client Supabase service-role usado pelo worker da fila (nunca no browser). */
export type AdminClient = ReturnType<typeof createAdminClient>;

/** Linha de `chatbot_queue` (schema real — ver `supabase/migrations/20260320700001_chatbot_queue.sql`,
 * `20260806140000_meta_messaging_channels.sql`, `20260805090000_chatbot_queue_reclaim_stuck.sql`). */
export interface ChatbotQueueJobRow {
    id: string;
    created_at: string;
    scheduled_at: string;
    status: "pending" | "processing" | "done" | "failed";
    attempts: number;
    last_error: string | null;
    company_id: string;
    thread_id: string;
    phone_e164: string;
    message_id: string | null;
    body_text: string;
    profile_name: string | null;
    messaging_channel: "whatsapp" | "instagram" | "messenger";
    channel_user_id: string | null;
    processing_started_at: string | null;
    metadata: ({ message_type?: string | null } & Record<string, unknown>) | null;
    /** ADR-0003 outbox — set after SQS SendMessage. */
    sqs_enqueued_at?: string | null;
    sqs_message_id?: string | null;
}

/** Contadores de um lote processado (usados no metric/response do worker). */
export interface QueueBatchCounters {
    processed: number;
    failed: number;
    coalesced: number;
}
