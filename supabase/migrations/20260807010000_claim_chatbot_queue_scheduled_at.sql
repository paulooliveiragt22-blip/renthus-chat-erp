-- Claim respeita scheduled_at futuro (backoff pós-429 / retry).
-- Mantém fairness por company + FOR UPDATE SKIP LOCKED + skip thread busy.

CREATE OR REPLACE FUNCTION public.claim_chatbot_queue_jobs(
    batch_size      integer DEFAULT 5,
    max_attempts    integer DEFAULT 3,
    max_per_company integer DEFAULT 2
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_batch   integer := greatest(1, least(coalesce(batch_size, 5), 50));
  v_max_att integer := greatest(1, least(coalesce(max_attempts, 3), 20));
  v_max_co  integer := greatest(1, least(coalesce(max_per_company, 2), v_batch));
BEGIN
  RETURN QUERY
  WITH company_rank AS (
    SELECT
      q.company_id,
      MIN(q.scheduled_at) AS oldest
    FROM public.chatbot_queue q
    WHERE q.status = 'pending'
      AND q.attempts < v_max_att
      AND q.scheduled_at <= now()
      AND (
        q.thread_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.chatbot_queue busy
          WHERE busy.thread_id = q.thread_id
            AND busy.status = 'processing'
        )
      )
    GROUP BY q.company_id
    ORDER BY MIN(q.scheduled_at) ASC
    LIMIT v_batch
  ),
  picked AS (
    SELECT x.id
    FROM company_rank cr
    CROSS JOIN LATERAL (
      SELECT q.id, q.scheduled_at
      FROM public.chatbot_queue q
      WHERE q.company_id = cr.company_id
        AND q.status = 'pending'
        AND q.attempts < v_max_att
        AND q.scheduled_at <= now()
        AND (
          q.thread_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.chatbot_queue busy
            WHERE busy.thread_id = q.thread_id
              AND busy.status = 'processing'
          )
        )
      ORDER BY q.scheduled_at ASC
      LIMIT v_max_co
      FOR UPDATE SKIP LOCKED
    ) x
    ORDER BY cr.oldest ASC, x.scheduled_at ASC
    LIMIT v_batch
  )
  UPDATE public.chatbot_queue q
  SET
    status                = 'processing',
    attempts              = attempts + 1,
    processing_started_at = now()
  FROM picked p
  WHERE q.id = p.id
  RETURNING q.id;
END;
$$;

COMMENT ON FUNCTION public.claim_chatbot_queue_jobs(integer, integer, integer) IS
  'Claim atómico com fairness, SKIP LOCKED, skip thread busy e respeito a scheduled_at (backoff).';
