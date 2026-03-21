-- RPC: claim_chatbot_queue_jobs
-- Seleciona e marca atomicamente N jobs pendentes como "processing".
-- Usa FOR UPDATE SKIP LOCKED para segurança em múltiplos workers.

CREATE OR REPLACE FUNCTION claim_chatbot_queue_jobs(
    batch_size  integer DEFAULT 5,
    max_attempts integer DEFAULT 3
)
RETURNS TABLE (id uuid)
LANGUAGE sql
VOLATILE
AS $$
    UPDATE chatbot_queue
    SET
        status   = 'processing',
        attempts = attempts + 1
    WHERE chatbot_queue.id IN (
        SELECT q.id
        FROM   chatbot_queue q
        WHERE  q.status   = 'pending'
          AND  q.attempts < max_attempts
        ORDER  BY q.scheduled_at ASC
        LIMIT  batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING chatbot_queue.id;
$$;
