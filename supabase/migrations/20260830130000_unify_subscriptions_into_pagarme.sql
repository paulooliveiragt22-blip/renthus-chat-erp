-- =============================================================================
-- Unificação: subscriptions (legada) → pagarme_subscriptions (canônica)
-- =============================================================================
-- Decisão (projeto-pre-producao-radical.mdc): SEM dual-path. Tudo na canônica.
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 1) Adicionar colunas faltantes em pagarme_subscriptions
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pagarme_subscriptions' AND column_name='allow_overage') THEN
    ALTER TABLE public.pagarme_subscriptions ADD COLUMN allow_overage boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pagarme_subscriptions' AND column_name='plan_key') THEN
    ALTER TABLE public.pagarme_subscriptions ADD COLUMN plan_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pagarme_subscriptions' AND column_name='plan_id') THEN
    ALTER TABLE public.pagarme_subscriptions ADD COLUMN plan_id uuid REFERENCES public.plans(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pagarme_subscriptions' AND column_name='started_at') THEN
    ALTER TABLE public.pagarme_subscriptions ADD COLUMN started_at timestamptz DEFAULT now();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) Backfill: copiar dados de subscriptions → pagarme_subscriptions
-- -----------------------------------------------------------------------------
UPDATE public.pagarme_subscriptions ps
SET
  allow_overage = COALESCE(s.allow_overage, false),
  plan_id = s.plan_id,
  plan_key = p.key,
  started_at = COALESCE(s.started_at, ps.created_at)
FROM public.subscriptions s
LEFT JOIN public.plans p ON p.id = s.plan_id
WHERE s.company_id = ps.company_id
  AND (ps.allow_overage != COALESCE(s.allow_overage, false)
       OR ps.plan_id IS DISTINCT FROM s.plan_id);

-- -----------------------------------------------------------------------------
-- 3) Backfill: criar registro para empresas que SÓ têm subscriptions
-- -----------------------------------------------------------------------------
INSERT INTO public.pagarme_subscriptions (
  company_id, plan, status, trial_ends_at, plan_id, allow_overage, activated_at, started_at, plan_key
)
SELECT
  s.company_id,
  COALESCE(p.key, 'bot')::subscription_plan,
  'active'::pagarme_sub_status,
  now() + interval '30 days',
  s.plan_id,
  COALESCE(s.allow_overage, false),
  s.started_at,
  s.started_at,
  p.key
FROM public.subscriptions s
-- -----------------------------------------------------------------------------
-- 4) check_and_increment_usage: ler de pagarme_subscriptions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_increment_usage(
  p_company uuid, p_feature text, p_amount int DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year_month text; v_limit int; v_used int; v_allow_overage boolean;
BEGIN
  v_year_month := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  SELECT fl.limit_per_month, COALESCE(ps.allow_overage, false)
    INTO v_limit, v_allow_overage
    FROM public.pagarme_subscriptions ps
    JOIN public.feature_limits fl ON fl.plan_id = ps.plan_id AND fl.feature_key = p_feature
   WHERE ps.company_id = p_company AND ps.status IN ('active', 'trial')
   LIMIT 1;
  IF v_limit IS NULL THEN v_limit := 999999999; END IF;
  IF v_allow_overage IS NULL THEN v_allow_overage := false; END IF;
  INSERT INTO public.usage_monthly (company_id, feature_key, year_month, used)
  VALUES (p_company, p_feature, v_year_month, 0)
  ON CONFLICT (company_id, feature_key, year_month) DO NOTHING;
  SELECT used INTO v_used FROM public.usage_monthly
   WHERE company_id = p_company AND feature_key = p_feature AND year_month = v_year_month;
  v_used := COALESCE(v_used, 0);
  IF v_used >= v_limit AND NOT v_allow_overage THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit, 'overage', false);
  END IF;
  UPDATE public.usage_monthly SET used = used + p_amount
   WHERE company_id = p_company AND feature_key = p_feature AND year_month = v_year_month;
  RETURN jsonb_build_object(
    'allowed', true, 'used', v_used + p_amount, 'limit', v_limit,
-- -----------------------------------------------------------------------------
-- 5) rpc_platform_change_subscription_plan: tabela alvo = pagarme_subscriptions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_platform_change_subscription_plan(
  p_subscription_id uuid, p_plan_key text,
  p_actor_id uuid, p_actor_email text, p_actor_role text,
  p_request_id text, p_ip_address text, p_user_agent text, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare v_sub record; v_plan_id uuid; v_before jsonb; v_after jsonb;
begin
  SELECT id, company_id, plan, status, allow_overage, plan_key INTO v_sub
    FROM public.pagarme_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF v_sub.id IS NULL THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
  SELECT id INTO v_plan_id FROM public.plans WHERE key = trim(p_plan_key) LIMIT 1;
  IF v_plan_id IS NULL THEN RAISE EXCEPTION 'plan_not_found'; END IF;
  v_before := jsonb_build_object('plan_key', v_sub.plan_key, 'plan', v_sub.plan, 'status', v_sub.status);
  UPDATE public.pagarme_subscriptions
     SET plan_id = v_plan_id, plan_key = trim(p_plan_key),
         plan = trim(p_plan_key)::subscription_plan, updated_at = now()
   WHERE id = p_subscription_id;
  v_after := jsonb_build_object('plan_key', trim(p_plan_key), 'plan', trim(p_plan_key), 'status', v_sub.status);
  PERFORM public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.subscription.plan_changed', 'subscription', p_subscription_id::text,
    v_sub.company_id, p_request_id, p_ip_address, p_user_agent,
    v_before, v_after, jsonb_build_object('reason', coalesce(p_reason, '')), 'success'
  );
end;
$$;
ALTER FUNCTION public.rpc_platform_change_subscription_plan(uuid, text, uuid, text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_platform_change_subscription_plan(uuid, text, uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_platform_change_subscription_plan(uuid, text, uuid, text, text, text, text, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 6) rpc_platform_set_subscription_overage
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_platform_set_subscription_overage(
  p_subscription_id uuid, p_allow_overage boolean,
  p_actor_id uuid, p_actor_email text, p_actor_role text,
  p_request_id text, p_ip_address text, p_user_agent text, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare v_sub record; v_before jsonb; v_after jsonb;
begin
  SELECT id, company_id, allow_overage INTO v_sub
-- -----------------------------------------------------------------------------
-- 7) rpc_platform_grant_courtesy_trial
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_platform_grant_courtesy_trial(
  p_company_id uuid, p_days integer,
  p_actor_id uuid, p_actor_email text, p_actor_role text,
  p_request_id text, p_ip_address text, p_user_agent text, p_reason text
)
RETURNS timestamp with time zone LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare v_sub record; v_before jsonb; v_after jsonb; v_trial_end timestamptz; v_id uuid;
begin
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'company_id required'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 14 THEN
    RAISE EXCEPTION 'courtesy trial days must be between 1 and 14';
  END IF;
  SELECT id, trial_ends_at, status INTO v_sub FROM public.pagarme_subscriptions
   WHERE company_id = p_company_id FOR UPDATE;
  v_trial_end := now() + (p_days || ' days')::interval;
  IF v_sub.id IS NULL THEN
    INSERT INTO public.pagarme_subscriptions (company_id, plan, status, trial_ends_at, activated_at)
    VALUES (p_company_id, 'bot', 'trial', v_trial_end, NULL)
    RETURNING id INTO v_id;
  ELSE
    v_before := jsonb_build_object('trial_ends_at', v_sub.trial_ends_at, 'status', v_sub.status);
    UPDATE public.pagarme_subscriptions
       SET trial_ends_at = v_trial_end, status = 'trial', updated_at = now()
     WHERE company_id = p_company_id
    RETURNING trial_ends_at, status INTO v_trial_end, v_sub.status;
    v_after := jsonb_build_object('trial_ends_at', v_trial_end, 'status', v_sub.status);
  END IF;
  PERFORM public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.subscription.courtesy_trial', 'subscription', COALESCE(v_id, v_sub.id)::text,
    p_company_id, p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, ''), 'days', p_days), 'success'
  );
  RETURN v_trial_end;
end;
$$;
ALTER FUNCTION public.rpc_platform_grant_courtesy_trial(uuid, integer, uuid, text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_platform_grant_courtesy_trial(uuid, integer, uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_platform_grant_courtesy_trial(uuid, integer, uuid, text, text, text, text, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 8) rpc_self_reactivate_subscription
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_self_reactivate_subscription(
  p_company_id uuid, p_plan_key text DEFAULT NULL
)
RETURNS timestamp with time zone LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare v_sub record; v_trial_end timestamptz;
begin
  SELECT id, status, trial_ends_at INTO v_sub FROM public.pagarme_subscriptions
   WHERE company_id = p_company_id FOR UPDATE;
-- -----------------------------------------------------------------------------
-- 9) rpc_ensure_first_invoice
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_ensure_first_invoice(p_company_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare v_sub record; v_plan record; v_invoice_id uuid;
begin
  SELECT id, plan_id, plan, status, plan_key INTO v_sub FROM public.pagarme_subscriptions
   WHERE company_id = p_company_id LIMIT 1;
  IF v_sub.id IS NULL THEN RAISE EXCEPTION 'pagarme_subscription_not_found'; END IF;
  IF v_sub.plan_id IS NULL THEN RAISE EXCEPTION 'plan_not_set'; END IF;
  SELECT id, key, name INTO v_plan FROM public.plans WHERE id = v_sub.plan_id LIMIT 1;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'plan_not_found'; END IF;
  SELECT id INTO v_invoice_id FROM public.invoices
   WHERE subscription_id = v_sub.id AND status = 'pending' LIMIT 1;
  IF v_invoice_id IS NULL THEN
    INSERT INTO public.invoices (company_id, subscription_id, amount, status, due_at)
    VALUES (p_company_id, v_sub.id, 297.00, 'pending', now() + interval '3 days')
    RETURNING id INTO v_invoice_id;
  END IF;
  RETURN v_invoice_id;
end;
$$;
ALTER FUNCTION public.rpc_ensure_first_invoice(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_ensure_first_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_ensure_first_invoice(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 10) rpc_get_company_entitlements
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_company_entitlements(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare v_company record; v_sub record; v_plan_id uuid; v_features text[];
begin
  SELECT id, is_active INTO v_company FROM public.companies WHERE id = p_company_id;
  IF v_company.id IS NULL THEN RETURN jsonb_build_object('error', 'company_not_found'); END IF;
  SELECT id, plan, status, trial_ends_at, last_paid_at, next_billing_at,
         activated_at, plan_id, plan_key, allow_overage
    INTO v_sub FROM public.pagarme_subscriptions WHERE company_id = p_company_id LIMIT 1;
  IF v_sub.id IS NOT NULL THEN
    v_plan_id := v_sub.plan_id;
    SELECT array_agg(feature_key) INTO v_features FROM public.feature_limits WHERE plan_id = v_plan_id;
  END IF;
  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'is_active', v_company.is_active,
    'pagarme', CASE WHEN v_sub.id IS NOT NULL THEN jsonb_build_object(
      'id', v_sub.id, 'plan', v_sub.plan, 'plan_key', v_sub.plan_key, 'status', v_sub.status,
      'trial_ends_at', v_sub.trial_ends_at, 'last_paid_at', v_sub.last_paid_at,
      'next_billing_at', v_sub.next_billing_at, 'activated_at', v_sub.activated_at,
      'allow_overage', v_sub.allow_overage
    ) ELSE NULL END,
    'subscription', CASE WHEN v_sub.id IS NOT NULL THEN jsonb_build_object(
      'id', v_sub.id, 'plan_id', v_sub.plan_id, 'plan_key', v_sub.plan_key,
      'plan_name', (SELECT name FROM public.plans WHERE id = v_sub.plan_id),
      'status', v_sub.status, 'allow_overage', v_sub.allow_overage
    ) ELSE NULL END,
    'features', COALESCE(v_features, ARRAY[]::text[])
  );
end;
$$;
ALTER FUNCTION public.rpc_get_company_entitlements(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_get_company_entitlements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_company_entitlements(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 11) Recriar v_whatsapp_usage_current_month preservando nomes de coluna
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_whatsapp_usage_current_month;
CREATE VIEW public.v_whatsapp_usage_current_month AS
SELECT
  ps.company_id,
  c.name AS company_name,
  COALESCE(um.used, 0)::int AS messages_used,
  COALESCE(fl.limit_per_month, 999999999)::int AS limit_per_month,
  CASE WHEN COALESCE(fl.limit_per_month, 999999999) > 0 AND COALESCE(um.used, 0) > fl.limit_per_month
       THEN COALESCE(um.used, 0) - fl.limit_per_month ELSE 0 END::int AS overage
FROM public.pagarme_subscriptions ps
JOIN public.companies c ON c.id = ps.company_id
LEFT JOIN public.usage_monthly um
  ON um.company_id = ps.company_id
 AND um.feature_key = 'whatsapp_messages'
 AND um.year_month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
LEFT JOIN public.feature_limits fl
  ON fl.plan_id = ps.plan_id
 AND fl.feature_key = 'whatsapp_messages'
WHERE ps.status IN ('active', 'trial');

GRANT SELECT ON public.v_whatsapp_usage_current_month TO service_role;

-- -----------------------------------------------------------------------------
-- 12) Dropar tabela subscriptions (legada) — DECISÃO RADICAL
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.subscriptions CASCADE;
  IF v_sub.id IS NULL THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
  IF v_sub.status NOT IN ('blocked', 'overdue', 'cancelled', 'pending_payment') THEN
    RAISE EXCEPTION 'cannot_reactivate_from_status_%', v_sub.status;
  END IF;
  v_trial_end := now() + interval '14 days';
  UPDATE public.pagarme_subscriptions
     SET status = 'trial', trial_ends_at = v_trial_end, updated_at = now()
   WHERE id = v_sub.id;
  RETURN v_trial_end;
end;
$$;
ALTER FUNCTION public.rpc_self_reactivate_subscription(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_self_reactivate_subscription(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_self_reactivate_subscription(uuid, text) TO service_role;
    FROM public.pagarme_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF v_sub.id IS NULL THEN RAISE EXCEPTION 'subscription_not_found'; END IF;
  v_before := jsonb_build_object('allow_overage', v_sub.allow_overage);
  UPDATE public.pagarme_subscriptions SET allow_overage = p_allow_overage, updated_at = now()
   WHERE id = p_subscription_id;
  v_after := jsonb_build_object('allow_overage', p_allow_overage);
  PERFORM public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.subscription.overage_changed', 'subscription', p_subscription_id::text,
    v_sub.company_id, p_request_id, p_ip_address, p_user_agent,
    v_before, v_after, jsonb_build_object('reason', coalesce(p_reason, '')), 'success'
  );
end;
$$;
ALTER FUNCTION public.rpc_platform_set_subscription_overage(uuid, boolean, uuid, text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_platform_set_subscription_overage(uuid, boolean, uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_platform_set_subscription_overage(uuid, boolean, uuid, text, text, text, text, text, text) TO service_role;
    'overage', (v_used >= v_limit AND v_allow_overage)
  );
END;
$$;
ALTER FUNCTION public.check_and_increment_usage(uuid, text, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_and_increment_usage(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_usage(uuid, text, int) TO service_role;
LEFT JOIN public.plans p ON p.id = s.plan_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.pagarme_subscriptions ps WHERE ps.company_id = s.company_id
);