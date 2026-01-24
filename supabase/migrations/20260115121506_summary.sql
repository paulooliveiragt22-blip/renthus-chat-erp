-- Mensagens diárias: retorna date (YYYY-MM-DD) e count
CREATE OR REPLACE FUNCTION renthus_reports_messages_daily(
  p_company_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  date text,
  count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    to_char(gs, 'YYYY-MM-DD') AS date,
    COALESCE(m.cnt, 0)::bigint AS count
  FROM
    generate_series(
      (p_start AT TIME ZONE 'UTC')::date,
      (p_end   AT TIME ZONE 'UTC')::date,
      '1 day'::interval
    ) gs
  LEFT JOIN (
    SELECT
      (wm.created_at AT TIME ZONE 'UTC')::date AS d,
      COUNT(*)::bigint AS cnt
    FROM whatsapp_messages wm
    JOIN whatsapp_threads wt ON wm.thread_id = wt.id
    WHERE
      wt.company_id = p_company_id
      AND wm.created_at >= p_start
      AND wm.created_at <= p_end
    GROUP BY (wm.created_at AT TIME ZONE 'UTC')::date
  ) m ON m.d = gs::date
  ORDER BY gs;
$$;


-- Orders diários: retorna date (YYYY-MM-DD), faturamento (SUM total_amount) e orders (COUNT)
CREATE OR REPLACE FUNCTION renthus_reports_orders_daily(
  p_company_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  date text,
  faturamento numeric,
  orders bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    to_char(gs, 'YYYY-MM-DD') AS date,
    COALESCE(o.faturamento, 0)::numeric AS faturamento,
    COALESCE(o.orders, 0)::bigint AS orders
  FROM
    generate_series(
      (p_start AT TIME ZONE 'UTC')::date,
      (p_end   AT TIME ZONE 'UTC')::date,
      '1 day'::interval
    ) gs
  LEFT JOIN (
    SELECT
      (created_at AT TIME ZONE 'UTC')::date AS d,
      SUM(COALESCE(total_amount, 0))::numeric AS faturamento,
      COUNT(*)::bigint AS orders
    FROM orders
    WHERE
      company_id = p_company_id
      AND created_at >= p_start
      AND created_at <= p_end
    GROUP BY (created_at AT TIME ZONE 'UTC')::date
  ) o ON o.d = gs::date
  ORDER BY gs;
$$;
