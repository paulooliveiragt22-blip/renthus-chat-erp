-- Reclaim de jobs travados em processing (worker serverless morto / timeout).
-- Atualiza claim para gravar processing_started_at.

ALTER TABLE public.chatbot_queue
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz NULL;

COMMENT ON COLUMN public.chatbot_queue.processing_started_at IS
  'Momento em que o job entrou em processing (claim). Usado para reclaim de stuck.';

CREATE INDEX IF NOT EXISTS chatbot_queue_processing_started_idx
  ON public.chatbot_queue (processing_started_at ASC)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.claim_chatbot_queue_jobs(
    batch_size   integer DEFAULT 5,
    max_attempts integer DEFAULT 3
)
RETURNS TABLE (id uuid)
LANGUAGE sql
VOLATILE
AS $$
    UPDATE public.chatbot_queue
    SET
        status                 = 'processing',
        attempts               = attempts + 1,
        processing_started_at  = now()
    WHERE chatbot_queue.id IN (
        SELECT q.id
        FROM   public.chatbot_queue q
        WHERE  q.status   = 'pending'
          AND  q.attempts < max_attempts
        ORDER  BY q.scheduled_at ASC
        LIMIT  batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING chatbot_queue.id;
$$;

CREATE OR REPLACE FUNCTION public.reclaim_stuck_chatbot_queue_jobs(
    stale_minutes integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_stale integer := greatest(1, least(coalesce(stale_minutes, 3), 60));
  v_count integer;
BEGIN
  UPDATE public.chatbot_queue q
  SET
    status                = 'pending',
    last_error            = left(
      coalesce(q.last_error || ' | ', '') || 'reclaimed_stuck_processing',
      500
    ),
    processing_started_at = NULL
  WHERE q.status = 'processing'
    AND q.attempts < 3
    AND (
      (q.processing_started_at IS NOT NULL
        AND q.processing_started_at < now() - make_interval(mins => v_stale))
      OR
      (q.processing_started_at IS NULL
        AND q.scheduled_at < now() - make_interval(mins => v_stale))
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_stuck_chatbot_queue_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reclaim_stuck_chatbot_queue_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_chatbot_queue_jobs(integer, integer) TO service_role;

COMMENT ON FUNCTION public.reclaim_stuck_chatbot_queue_jobs(integer) IS
  'Devolve jobs processing antigos para pending (pico / timeout serverless).';
