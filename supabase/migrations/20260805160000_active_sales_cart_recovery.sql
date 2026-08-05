-- Venda ativa — Fase 1: recuperação de carrinho dentro da janela de 24h.
--
-- 1. whatsapp_threads.last_inbound_at — base correta da janela de atendimento Meta.
--    `last_message_at` é atualizado também por outbound, então não serve para a janela.
-- 2. abandoned_carts — snapshot do rascunho antes de chatbot_sessions expirar (~2h).
-- 3. outbound_jobs — fila de mensagens proativas, claim justo por empresa.

-- ─── 1. Janela de atendimento: último inbound por thread ──────────────────────

ALTER TABLE whatsapp_threads
    ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

CREATE OR REPLACE FUNCTION increment_thread_unread()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.direction IN ('inbound', 'in') THEN
        UPDATE whatsapp_threads
        SET unread_count    = unread_count + 1,
            last_inbound_at = GREATEST(
                COALESCE(last_inbound_at, COALESCE(NEW.created_at, now())),
                COALESCE(NEW.created_at, now())
            )
        WHERE id = NEW.thread_id;
    END IF;
    RETURN NEW;
END;
$$;

UPDATE whatsapp_threads t
SET last_inbound_at = m.max_created
FROM (
    SELECT thread_id, MAX(created_at) AS max_created
    FROM whatsapp_messages
    WHERE direction IN ('inbound', 'in')
      AND thread_id IS NOT NULL
    GROUP BY thread_id
) m
WHERE m.thread_id = t.id
  AND t.last_inbound_at IS DISTINCT FROM m.max_created;

CREATE INDEX IF NOT EXISTS whatsapp_threads_last_inbound_idx
    ON whatsapp_threads (company_id, last_inbound_at DESC);

-- ─── 2. abandoned_carts ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS abandoned_carts (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         uuid        NOT NULL,
    thread_id          uuid        NOT NULL,
    customer_id        uuid,
    phone_e164         text        NOT NULL,
    draft              jsonb       NOT NULL,
    item_count         integer     NOT NULL,
    grand_total        numeric(12,2),
    status             text        NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'notified', 'recovered', 'expired', 'discarded')),
    detected_at        timestamptz NOT NULL DEFAULT now(),
    notified_at        timestamptz,
    recovered_at       timestamptz,
    recovered_order_id uuid,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- Um carrinho em aberto por thread: é o que impede notificar duas vezes o mesmo abandono.
CREATE UNIQUE INDEX IF NOT EXISTS abandoned_carts_open_thread_idx
    ON abandoned_carts (thread_id)
    WHERE status IN ('open', 'notified');

CREATE INDEX IF NOT EXISTS abandoned_carts_company_idx
    ON abandoned_carts (company_id, status, detected_at DESC);

ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;

-- ─── 3. outbound_jobs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outbound_jobs (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at            timestamptz NOT NULL DEFAULT now(),
    scheduled_at          timestamptz NOT NULL DEFAULT now(),
    processing_started_at timestamptz,
    status                text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
    attempts              integer     NOT NULL DEFAULT 0,
    last_error            text,
    skip_reason           text,
    company_id            uuid        NOT NULL,
    thread_id             uuid        NOT NULL,
    phone_e164            text        NOT NULL,
    purpose               text        NOT NULL
                          CHECK (purpose IN ('cart_recovery', 'reengagement', 'promo', 'transactional')),
    payload               jsonb       NOT NULL,
    dedup_key             text        NOT NULL,
    source_id             uuid,
    sent_at               timestamptz,
    sent_message_id       text
);

CREATE UNIQUE INDEX IF NOT EXISTS outbound_jobs_dedup_idx
    ON outbound_jobs (company_id, dedup_key);

CREATE INDEX IF NOT EXISTS outbound_jobs_pending_idx
    ON outbound_jobs (scheduled_at ASC)
    WHERE status = 'pending';

-- Teto de frequência por cliente: contagem de proativas já entregues na thread.
CREATE INDEX IF NOT EXISTS outbound_jobs_sent_idx
    ON outbound_jobs (thread_id, sent_at DESC)
    WHERE sent_at IS NOT NULL;

ALTER TABLE outbound_jobs ENABLE ROW LEVEL SECURITY;

-- ─── 4. Detecção de carrinho abandonado ───────────────────────────────────────
--
-- Roda em SQL porque o rascunho vive no jsonb da sessão e a janela de detecção
-- precisa ser atômica com o insert (o índice parcial único faz a deduplicação).

CREATE OR REPLACE FUNCTION public.detect_abandoned_carts(
    p_idle_minutes integer DEFAULT 25,
    p_limit        integer DEFAULT 50
)
RETURNS TABLE (
    id          uuid,
    company_id  uuid,
    thread_id   uuid,
    customer_id uuid,
    phone_e164  text,
    draft       jsonb,
    item_count  integer,
    grand_total numeric
)
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_idle  integer := greatest(5, least(coalesce(p_idle_minutes, 25), 240));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  RETURN QUERY
  WITH candidate AS (
    -- Prefixo `c_`: os nomes de saída da função sombreiam colunas dentro do corpo.
    SELECT
      cs.company_id  AS c_company_id,
      cs.thread_id   AS c_thread_id,
      cs.customer_id AS c_customer_id,
      wt.phone_e164  AS c_phone_e164,
      (cs.context -> '__pro_v2_state' -> 'draft') AS c_draft,
      jsonb_array_length(
        COALESCE(cs.context -> '__pro_v2_state' -> 'draft' -> 'items', '[]'::jsonb)
      ) AS c_item_count,
      NULLIF(cs.context -> '__pro_v2_state' -> 'draft' ->> 'grandTotal', '')::numeric AS c_grand_total
    FROM public.chatbot_sessions cs
    JOIN public.whatsapp_threads wt ON wt.id = cs.thread_id
    WHERE cs.updated_at < now() - make_interval(mins => v_idle)
      AND jsonb_array_length(
        COALESCE(cs.context -> '__pro_v2_state' -> 'draft' -> 'items', '[]'::jsonb)
      ) > 0
      AND COALESCE(cs.context -> '__pro_v2_state' ->> 'step', '') NOT IN ('pro_idle', 'handover')
      -- Humano assumiu a conversa: não interromper com mensagem automática.
      AND COALESCE(wt.bot_active, true) = true
      -- Só dentro da janela de 24h: fora dela exigiria template HSM aprovado.
      AND wt.last_inbound_at IS NOT NULL
      AND wt.last_inbound_at > now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM public.abandoned_carts ac0
        WHERE ac0.thread_id = cs.thread_id
          AND ac0.status IN ('open', 'notified')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.orders o
        LEFT JOIN public.customers c ON c.id = o.customer_id
        WHERE o.company_id = cs.company_id
          AND o.created_at > cs.updated_at - make_interval(mins => v_idle)
          AND (c.phone_e164 = wt.phone_e164 OR o.customer_phone = wt.phone_e164)
      )
    ORDER BY cs.updated_at ASC
    LIMIT v_limit
  ),
  inserted AS (
    INSERT INTO public.abandoned_carts AS ac (
      company_id, thread_id, customer_id, phone_e164, draft, item_count, grand_total
    )
    SELECT
      cd.c_company_id, cd.c_thread_id, cd.c_customer_id, cd.c_phone_e164,
      cd.c_draft, cd.c_item_count, cd.c_grand_total
    FROM candidate cd
    ON CONFLICT DO NOTHING
    RETURNING
      ac.id, ac.company_id, ac.thread_id, ac.customer_id,
      ac.phone_e164, ac.draft, ac.item_count, ac.grand_total
  )
  SELECT
    i.id, i.company_id, i.thread_id, i.customer_id,
    i.phone_e164, i.draft, i.item_count, i.grand_total
  FROM inserted i;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_abandoned_carts(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_abandoned_carts(integer, integer) TO service_role;

COMMENT ON FUNCTION public.detect_abandoned_carts(integer, integer) IS
  'Snapshot de rascunhos parados com itens, dentro da janela de 24h e sem pedido recente.';

-- ─── 5. Claim justo da fila de outbound ───────────────────────────────────────
-- Mesmo desenho de claim_chatbot_queue_jobs: teto por empresa, skip de thread
-- já em processing, SKIP LOCKED. Adiciona respeito a scheduled_at futuro.

CREATE OR REPLACE FUNCTION public.claim_outbound_jobs(
    batch_size      integer DEFAULT 10,
    max_attempts    integer DEFAULT 3,
    max_per_company integer DEFAULT 3
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_batch   integer := greatest(1, least(coalesce(batch_size, 10), 100));
  v_max_att integer := greatest(1, least(coalesce(max_attempts, 3), 20));
  v_max_co  integer := greatest(1, least(coalesce(max_per_company, 3), v_batch));
BEGIN
  RETURN QUERY
  WITH company_rank AS (
    SELECT
      q.company_id,
      MIN(q.scheduled_at) AS oldest
    FROM public.outbound_jobs q
    WHERE q.status = 'pending'
      AND q.attempts < v_max_att
      AND q.scheduled_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.outbound_jobs busy
        WHERE busy.thread_id = q.thread_id
          AND busy.status = 'processing'
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
      FROM public.outbound_jobs q
      WHERE q.company_id = cr.company_id
        AND q.status = 'pending'
        AND q.attempts < v_max_att
        AND q.scheduled_at <= now()
        AND NOT EXISTS (
          SELECT 1
          FROM public.outbound_jobs busy
          WHERE busy.thread_id = q.thread_id
            AND busy.status = 'processing'
        )
      ORDER BY q.scheduled_at ASC
      LIMIT v_max_co
      FOR UPDATE SKIP LOCKED
    ) x
    ORDER BY cr.oldest ASC, x.scheduled_at ASC
    LIMIT v_batch
  )
  UPDATE public.outbound_jobs q
  SET
    status                = 'processing',
    attempts              = attempts + 1,
    processing_started_at = now()
  FROM picked p
  WHERE q.id = p.id
  RETURNING q.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_outbound_jobs(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_outbound_jobs(integer, integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_outbound_jobs(integer, integer, integer) IS
  'Claim atómico da fila proativa com fairness por company_id e single-flight por thread.';

-- ─── 6. Devolver jobs presos ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reclaim_stuck_outbound_jobs(
    stale_minutes integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_stale integer := greatest(1, least(coalesce(stale_minutes, 5), 120));
  v_count integer;
BEGIN
  UPDATE public.outbound_jobs
  SET status = 'pending'
  WHERE status = 'processing'
    AND processing_started_at < now() - make_interval(mins => v_stale);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_stuck_outbound_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reclaim_stuck_outbound_jobs(integer) TO service_role;

-- ─── 7. Atribuição de recuperação ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_abandoned_cart_recovered(
    p_company_id uuid,
    p_thread_id  uuid,
    p_order_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_cart_id uuid;
BEGIN
  UPDATE public.abandoned_carts
  SET status             = 'recovered',
      recovered_at       = now(),
      recovered_order_id = p_order_id
  WHERE company_id = p_company_id
    AND thread_id = p_thread_id
    AND status IN ('open', 'notified')
  RETURNING id INTO v_cart_id;

  RETURN v_cart_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_abandoned_cart_recovered(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_cart_recovered(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.mark_abandoned_cart_recovered(uuid, uuid, uuid) IS
  'Fecha o carrinho abandonado da thread quando um pedido é criado (atribuição de receita recuperada).';

-- ─── 8. Expiração de carrinhos não recuperados ────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_stale_abandoned_carts(
    p_max_age_hours integer DEFAULT 48
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_hours integer := greatest(1, least(coalesce(p_max_age_hours, 48), 720));
  v_count integer;
BEGIN
  UPDATE public.abandoned_carts
  SET status = 'expired'
  WHERE status IN ('open', 'notified')
    AND detected_at < now() - make_interval(hours => v_hours);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_abandoned_carts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_abandoned_carts(integer) TO service_role;
