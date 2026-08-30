-- Migration: Billing Abandoned Status + Self-Reactivation
-- Fase 1 - Ciclo de vida Tenant completo
-- Reversivel: NAO (DROP TYPE VALUE nao suportado em PG <17)
BEGIN;

-- PASSO 1: Adicionar 'abandoned' ao enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'pagarme_sub_status'
      AND e.enumlabel = 'abandoned'
  ) THEN
    ALTER TYPE public.pagarme_sub_status ADD VALUE 'abandoned';
  END IF;
END $$;

-- PASSO 2: Colunas de tracking
ALTER TABLE public.pagarme_subscriptions
  ADD COLUMN IF NOT EXISTS abandoned_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS self_reactivation_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz NOT NULL DEFAULT now();

-- PASSO 3: Trigger para manter abandoned_at e last_status_change_at
CREATE OR REPLACE FUNCTION public.tg_pagarme_subs_touch_status_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_change_at := now();
    IF NEW.status = 'abandoned' AND (OLD.status IS NULL OR OLD.status <> 'abandoned') THEN
      NEW.abandoned_at := now();
    END IF;
    IF OLD.status = 'abandoned' AND NEW.status <> 'abandoned' THEN
      NEW.abandoned_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagarme_subs_status_change ON public.pagarme_subscriptions;
CREATE TRIGGER trg_pagarme_subs_status_change
  BEFORE UPDATE OF status ON public.pagarme_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_pagarme_subs_touch_status_change();

-- PASSO 4: Backfill - never-paid > 30 dias -> abandoned (legados)
UPDATE public.pagarme_subscriptions ps
SET status = 'abandoned', abandoned_at = now(), last_status_change_at = now()
WHERE ps.last_paid_at IS NULL
  AND ps.status IN ('pending_payment', 'pending_setup')
  AND ps.created_at < now() - interval '30 days'
  AND (ps.last_status_change_at IS NULL OR ps.last_status_change_at < now() - interval '30 days');

-- PASSO 5: Indices para performance dos crons
CREATE INDEX IF NOT EXISTS idx_pagarme_subs_abandoned
  ON public.pagarme_subscriptions (status, last_paid_at, last_status_change_at)
  WHERE status IN ('abandoned', 'pending_payment', 'pending_setup');

CREATE INDEX IF NOT EXISTS idx_pagarme_subs_trial_ends
  ON public.pagarme_subscriptions (trial_ends_at)
  WHERE status = 'trial';

-- PASSO 6: RPC - Reativacao self-service pelo dono
-- Limite anti-abuso: max 1 reativacao por empresa a cada 60 dias
CREATE OR REPLACE FUNCTION public.rpc_self_reactivate_subscription(
  p_company_id uuid,
  p_plan_key   text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id     uuid := auth.uid();
  v_is_owner    boolean;
  v_sub         record;
  v_now         timestamptz := now();
  v_trial_end   timestamptz;
  v_cooldown    interval := interval '60 days';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = p_company_id
      AND cu.user_id    = v_user_id
      AND cu.role       = 'owner'
      AND cu.is_active  = true
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'forbidden: not_owner';
  END IF;

  SELECT * INTO v_sub
  FROM public.pagarme_subscriptions
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'subscription_not_found';
  END IF;

  IF v_sub.status NOT IN ('abandoned', 'blocked', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status_for_reactivation: current status is %', v_sub.status;
  END IF;

  IF v_sub.abandoned_at IS NOT NULL
     AND v_sub.abandoned_at > v_now - v_cooldown
     AND v_sub.self_reactivation_count > 0 THEN
    RAISE EXCEPTION 'reactivation_cooldown_active: wait until %',
      (v_sub.abandoned_at + v_cooldown)::date;
  END IF;

  v_trial_end := v_now + (
    CASE
      WHEN p_plan_key = 'market'    THEN interval '7 days'
      WHEN p_plan_key = 'essencial' THEN interval '14 days'
      ELSE interval '7 days'
    END
  );

  UPDATE public.pagarme_subscriptions
  SET
    status                  = 'trial',
    trial_ends_at           = v_trial_end,
    activated_at            = COALESCE(activated_at, v_now),
    abandoned_at            = NULL,
    self_reactivation_count = self_reactivation_count + 1,
    last_status_change_at   = v_now,
    updated_at              = v_now
  WHERE id = v_sub.id;

  UPDATE public.companies
  SET is_active  = true,
      updated_at = v_now
  WHERE id = p_company_id;

  RAISE NOTICE 'Self-reactivation: company=% user=% plan=% trial_until=%',
    p_company_id, v_user_id, p_plan_key, v_trial_end;

  RETURN v_trial_end;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_self_reactivate_subscription(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_self_reactivate_subscription(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_self_reactivate_subscription(uuid, text) TO service_role;

COMMIT;
