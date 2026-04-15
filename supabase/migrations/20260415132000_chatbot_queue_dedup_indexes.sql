-- Índices para dedup/coalescing do pipeline PRO.
-- Objetivo: manter lookup de duplicidade barato no webhook e no worker.

-- Webhook enqueue dedup:
-- filtro por thread + telefone + janela de created_at + status.
CREATE INDEX IF NOT EXISTS chatbot_queue_dedup_enqueue_idx
    ON chatbot_queue (thread_id, phone_e164, created_at DESC)
    INCLUDE (status, body_text);

-- Worker coalescing por thread.
CREATE INDEX IF NOT EXISTS chatbot_queue_coalesce_thread_idx
    ON chatbot_queue (thread_id, status, created_at DESC)
    INCLUDE (phone_e164, company_id, body_text);

-- Worker coalescing por telefone.
CREATE INDEX IF NOT EXISTS chatbot_queue_coalesce_phone_idx
    ON chatbot_queue (phone_e164, status, created_at DESC)
    INCLUDE (thread_id, company_id, body_text);

-- Worker coalescing por empresa (fallback).
CREATE INDEX IF NOT EXISTS chatbot_queue_coalesce_company_idx
    ON chatbot_queue (company_id, status, created_at DESC)
    INCLUDE (thread_id, phone_e164, body_text);
