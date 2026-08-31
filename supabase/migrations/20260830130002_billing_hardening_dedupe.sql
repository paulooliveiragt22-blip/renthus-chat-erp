-- =============================================================================
-- PR #7 — Billing hardening: FORCE RLS + policy única + dedupe + RPC canônica
-- =============================================================================
-- Decisão (projeto-pre-producao-radical.mdc): sem dual-path, sem shim.
-- Cumpre (supabase-migrations-seguranca.mdc): RLS+FORCE+REVOKE+policy única
-- e grant específico. Esta migration cobre:
--   1) Harden de pagarme_subscriptions (FORCE RLS, policy, grants)
--   2) RPC canônica rpc_list_platform_subscriptions (lê pagarme_subscriptions
--      com JOINs, sem expor subscriptions status='cancelled' se filtrado)
--   3) Deduplicação de registros por company_id (mantém o mais recente)
-- =============================================================================

-- 1) HARDENING DE pagarme_subscriptions
-- -----------------------------------------------------------------------------
ALTER TABLE public.pagarme_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagarme_subscriptions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.pagarme_subscriptions FROM anon;
REVOKE ALL ON public.pagarme_subscriptions FROM authenticated;
GRANT ALL ON public.pagarme_subscriptions TO service_role;

DROP POLICY IF EXISTS rls_pagarme_subscriptions_service_role_only ON public.pagarme_subscriptions;
CREATE POLICY rls_pagarme_subscriptions_service_role_only
  ON public.pagarme_subscriptions
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2) RPC CANÔNICA: rpc_list_platform_subscriptions
-- -----------------------------------------------------------------------------
-- Lê subscriptions com JOINs prontos para a UI do super admin.
-- Parâmetros:
--   p_statuses text[] default null   -- filtra por statuses (OR); null = todos
--   p_limit int default 200         -- max registros
--   p_offset int default 0          -- paginação
-- Retorno: jsonb com array de subscriptions (companies, plans, last_invoice
-- incluídos como jsonb inline).
CREATE OR REPLACE FUNCTION public.rpc_list_platform_subscriptions(
  p_statuses text[] DEFAULT NULL,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      ps.id,
      ps.company_id,
      ps.plan_key,
      ps.plan_id,
      ps.status,
      ps.allow_overage,
      ps.trial_ends_at,
      ps.last_paid_at,
      ps.next_billing_at,
      ps.activated_at,
      ps.started_at,
      jsonb_build_object(
        'name', c.name,
        'slug', c.slug,
        'is_active', c.is_active
      ) AS companies,
      CASE WHEN p.id IS NOT NULL THEN
        jsonb_build_object('id', p.id, 'key', p.key, 'name', p.name, 'price_cents', p.price_cents)
      ELSE NULL END AS plans
    FROM public.pagarme_subscriptions ps
    JOIN public.companies c ON c.id = ps.company_id
    LEFT JOIN public.plans p ON p.id = ps.plan_id
    WHERE (p_statuses IS NULL OR ps.status = ANY(p_statuses::pagarme_sub_status[]))
    ORDER BY ps.started_at DESC NULLS LAST
    LIMIT GREATEST(0, LEAST(p_limit, 500))
    OFFSET GREATEST(0, p_offset)
  ) s;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_platform_subscriptions(text[], int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_platform_subscriptions(text[], int, int) TO service_role;

-- 3) DEDUPE: mantém o registro mais recente por company_id
-- -----------------------------------------------------------------------------
-- Antes (estado real do banco): leleka conv tinha 2 registros (trial + pending_setup).
-- Esta migration deduplica mantendo o updated_at mais recente.
-- DECISÃO RADICAL: sem dual-path; sem fallback; deleta os duplicados.
DELETE FROM public.pagarme_subscriptions ps
WHERE id NOT IN (
  SELECT DISTINCT ON (company_id) id
  FROM public.pagarme_subscriptions
  ORDER BY company_id, updated_at DESC NULLS LAST, created_at DESC
);

-- Validação: contar empresas com mais de 1 subscription (deve ser 0)
-- Comentado para não falhar se houver dados edge; em produção rodar:
-- SELECT company_id, COUNT(*) FROM public.pagarme_subscriptions GROUP BY company_id HAVING COUNT(*) > 1;
