-- O2 / ADR-0004 B5: entitlements leem plan_features (boolean), não feature_limits (cota).
-- Restaura TenantAccess AND na RPC (perdido no unify 20260830130000).
-- Catálogo comercial de quais keys por plano = próxima rodada produto.

CREATE OR REPLACE FUNCTION public.rpc_get_company_entitlements(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pagarme record;
  v_features jsonb := '[]'::jsonb;
  v_limits jsonb := '{}'::jsonb;
  v_reason text := 'missing';
  v_access text := 'deny';
  v_features_eligible boolean := false;
  v_now timestamptz := now();
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'company_id', null,
      'access', 'deny',
      'access_reason', 'missing',
      'features_eligible', false,
      'features', '[]'::jsonb,
      'limits', '{}'::jsonb
    );
  END IF;

  SELECT
    ps.id,
    ps.status,
    ps.plan,
    ps.plan_key,
    ps.plan_id,
    ps.trial_ends_at,
    ps.last_paid_at,
    ps.next_billing_at,
    ps.activated_at,
    ps.allow_overage
  INTO v_pagarme
  FROM public.pagarme_subscriptions ps
  WHERE ps.company_id = p_company_id
  LIMIT 1;

  IF v_pagarme.status IS NULL THEN
    v_reason := 'missing';
  ELSE
    CASE lower(v_pagarme.status::text)
      WHEN 'blocked' THEN v_reason := 'blocked';
      WHEN 'cancelled' THEN v_reason := 'cancelled';
      WHEN 'abandoned' THEN v_reason := 'abandoned';
      WHEN 'pending_payment' THEN v_reason := 'pending_payment';
      WHEN 'pending_setup' THEN v_reason := 'pending_setup';
      WHEN 'active' THEN v_reason := 'active';
      WHEN 'trial' THEN
        IF v_pagarme.trial_ends_at IS NULL OR v_pagarme.trial_ends_at <= v_now THEN
          v_reason := 'trial_expired';
        ELSE
          v_reason := 'trial';
        END IF;
      WHEN 'overdue' THEN
        IF v_pagarme.last_paid_at IS NOT NULL THEN
          v_reason := 'overdue';
        ELSE
          v_reason := 'pending_payment';
        END IF;
      ELSE
        v_reason := 'missing';
    END CASE;
  END IF;

  IF v_reason IN ('trial', 'active', 'overdue') THEN
    v_access := 'allow';
    v_features_eligible := true;
  ELSE
    v_access := 'deny';
    v_features_eligible := false;
  END IF;

  IF v_features_eligible AND v_pagarme.plan_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(pf.feature_key ORDER BY pf.feature_key), '[]'::jsonb)
    INTO v_features
    FROM public.plan_features pf
    WHERE pf.plan_id = v_pagarme.plan_id;

    SELECT coalesce(
      jsonb_object_agg(fl.feature_key, fl.limit_per_month),
      '{}'::jsonb
    )
    INTO v_limits
    FROM public.feature_limits fl
    WHERE fl.plan_id = v_pagarme.plan_id;
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'access', v_access,
    'access_reason', v_reason,
    'features_eligible', v_features_eligible,
    'pagarme', CASE
      WHEN v_pagarme.id IS NULL THEN null
      ELSE jsonb_build_object(
        'id', v_pagarme.id,
        'status', v_pagarme.status,
        'plan', v_pagarme.plan,
        'plan_key', v_pagarme.plan_key,
        'trial_ends_at', v_pagarme.trial_ends_at,
        'last_paid_at', v_pagarme.last_paid_at,
        'next_billing_at', v_pagarme.next_billing_at,
        'activated_at', v_pagarme.activated_at,
        'allow_overage', v_pagarme.allow_overage
      )
    END,
    'subscription', CASE
      WHEN (NOT v_features_eligible) OR v_pagarme.id IS NULL OR v_pagarme.plan_id IS NULL THEN null
      ELSE jsonb_build_object(
        'id', v_pagarme.id,
        'plan_id', v_pagarme.plan_id,
        'plan_key', coalesce(v_pagarme.plan_key, v_pagarme.plan::text),
        'plan_name', (SELECT name FROM public.plans WHERE id = v_pagarme.plan_id),
        'status', v_pagarme.status,
        'allow_overage', coalesce(v_pagarme.allow_overage, false)
      )
    END,
    'features', v_features,
    'limits', v_limits
  );
END;
$$;

ALTER FUNCTION public.rpc_get_company_entitlements(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_get_company_entitlements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_company_entitlements(uuid) TO service_role;

COMMENT ON FUNCTION public.rpc_get_company_entitlements(uuid) IS
  'Entitlements: features de plan_features; limits de feature_limits; features=[] se TenantAccess deny. Catálogo por plano = produto (próxima rodada).';
