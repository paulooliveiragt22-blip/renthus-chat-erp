-- Fase 9 de docs/PLANO_MULTI_PROVIDER_IA.md: segmenta "Métricas PRO pipeline" (Super Admin) por
-- provider (anthropic|openai), usando a tag `provider` já emitida por runProPipeline.ts (pro_pipeline.run
-- e demais métricas do run) e por lib/chatbot/llmResilience.ts (pro_pipeline.llm_circuit_open/close).
-- Assinatura de retorno muda (nova coluna provider_key) — precisa DROP + CREATE, não CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.superadmin_pro_pipeline_metric_totals(integer);

CREATE FUNCTION public.superadmin_pro_pipeline_metric_totals(p_window_minutes integer DEFAULT 15)
RETURNS TABLE (
    company_id uuid,
    metric_name text,
    reason_key text,
    intent_key text,
    error_code text,
    provider_key text,
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
        COALESCE(NULLIF(e.tags ->> 'provider', ''), '')::text AS provider_key,
        SUM(e.value)::bigint AS total
    FROM public.pro_pipeline_metric_events e
    WHERE e.created_at >= now() - (p_window_minutes::double precision * interval '1 minute')
    GROUP BY
        e.company_id,
        e.metric_name,
        COALESCE(NULLIF(e.tags ->> 'reason', ''), ''),
        COALESCE(NULLIF(e.tags ->> 'intent', ''), ''),
        COALESCE(NULLIF(e.tags ->> 'errorCode', ''), ''),
        COALESCE(NULLIF(e.tags ->> 'provider', ''), '')
    ORDER BY total DESC;
$$;

REVOKE ALL ON FUNCTION public.superadmin_pro_pipeline_metric_totals(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadmin_pro_pipeline_metric_totals(integer) TO service_role;

COMMENT ON FUNCTION public.superadmin_pro_pipeline_metric_totals(integer) IS
    'Agrega pro_pipeline_metric_events por empresa/métrica/reason/intent/errorCode/provider para o Super Admin.';
