-- Camada 2: eventos de métrica do motor PRO (pro_pipeline.* + tags) para agregação no Super Admin.

CREATE TABLE IF NOT EXISTS public.pro_pipeline_metric_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    thread_id text,
    metric_name text NOT NULL,
    value numeric NOT NULL DEFAULT 1,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS pro_pipeline_metric_events_created_at_idx
    ON public.pro_pipeline_metric_events (created_at DESC);

CREATE INDEX IF NOT EXISTS pro_pipeline_metric_events_company_created_idx
    ON public.pro_pipeline_metric_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pro_pipeline_metric_events_metric_created_idx
    ON public.pro_pipeline_metric_events (metric_name, created_at DESC);

ALTER TABLE public.pro_pipeline_metric_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pro_pipeline_metric_events FROM PUBLIC;
GRANT INSERT, SELECT ON TABLE public.pro_pipeline_metric_events TO service_role;

CREATE OR REPLACE FUNCTION public.superadmin_pro_pipeline_metric_totals(p_window_minutes integer DEFAULT 15)
RETURNS TABLE (
    company_id uuid,
    metric_name text,
    reason_key text,
    intent_key text,
    error_code text,
    total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.company_id,
        e.metric_name,
        COALESCE(NULLIF(e.tags ->> 'reason', ''), '')::text AS reason_key,
        COALESCE(NULLIF(e.tags ->> 'intent', ''), '')::text AS intent_key,
        COALESCE(NULLIF(e.tags ->> 'errorCode', ''), '')::text AS error_code,
        SUM(e.value)::bigint AS total
    FROM public.pro_pipeline_metric_events e
    WHERE e.created_at >= now() - (p_window_minutes::double precision * interval '1 minute')
    GROUP BY
        e.company_id,
        e.metric_name,
        COALESCE(NULLIF(e.tags ->> 'reason', ''), ''),
        COALESCE(NULLIF(e.tags ->> 'intent', ''), ''),
        COALESCE(NULLIF(e.tags ->> 'errorCode', ''), '')
    ORDER BY total DESC;
$$;

REVOKE ALL ON FUNCTION public.superadmin_pro_pipeline_metric_totals(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadmin_pro_pipeline_metric_totals(integer) TO service_role;

COMMENT ON TABLE public.pro_pipeline_metric_events IS
    'Eventos de telemetria do PRO pipeline V2 (MetricsPort); agregados no Super Admin via RPC superadmin_pro_pipeline_metric_totals.';
