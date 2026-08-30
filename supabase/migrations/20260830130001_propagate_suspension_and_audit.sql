-- =============================================================================
-- Prioridade Alta #3: rpc_platform_suspend_company propaga status
-- Prioridade Média #4: trigger de auditoria em mudança de status
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 1) rpc_platform_suspend_company: agora bloqueia em pagarme_subscriptions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_platform_suspend_company(
  p_company_id uuid, p_actor_id uuid, p_actor_email text, p_actor_role text,
  p_request_id text, p_ip_address text, p_user_agent text, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_before jsonb;
  v_after jsonb;
  v_channels int;
  v_sub_before jsonb;
  v_sub_after jsonb;
begin
  SELECT jsonb_build_object('is_active', is_active) INTO v_before
    FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
  SELECT jsonb_build_object('status', status) INTO v_sub_before
    FROM public.pagarme_subscriptions WHERE company_id = p_company_id LIMIT 1;
  UPDATE public.companies SET is_active = false, updated_at = now()
   WHERE id = p_company_id;
  UPDATE public.pagarme_subscriptions
     SET status = 'blocked', updated_at = now()
   WHERE company_id = p_company_id
     AND status NOT IN ('blocked', 'cancelled');
  SELECT jsonb_build_object('status', status) INTO v_sub_after
    FROM public.pagarme_subscriptions WHERE company_id = p_company_id LIMIT 1;
  UPDATE public.whatsapp_channels
     SET status = 'inactive',
         provider_metadata = coalesce(provider_metadata, '{}'::jsonb)
           || jsonb_build_object('suspended_by_platform', true)
   WHERE company_id = p_company_id AND status = 'active';
  GET DIAGNOSTICS v_channels = ROW_COUNT;
  v_after := jsonb_build_object('is_active', false, 'channels_deactivated', v_channels,
                                 'subscription_status', v_sub_after->'status');
  PERFORM public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.company.suspended', 'company', p_company_id::text, p_company_id,
    p_request_id, p_ip_address, p_user_agent,
    jsonb_build_object('company', v_before, 'subscription', v_sub_before),
    jsonb_build_object('company', v_after, 'subscription', v_sub_after),
    jsonb_build_object('reason', coalesce(p_reason, ''), 'channels_deactivated', v_channels),
    'success'
  );
end;
-- -----------------------------------------------------------------------------
-- 2) Tabela de histórico + trigger de auditoria em pagarme_subscriptions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagarme_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.pagarme_subscriptions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  old_status pagarme_sub_status,
  new_status pagarme_sub_status NOT NULL,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text DEFAULT current_user
);

ALTER TABLE public.pagarme_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagarme_status_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pagarme_status_history FROM anon;
REVOKE ALL ON public.pagarme_status_history FROM authenticated;

CREATE POLICY rls_pagarme_status_history_service_role_only
  ON public.pagarme_status_history
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.pagarme_status_history TO service_role;

CREATE INDEX IF NOT EXISTS idx_pagarme_status_history_sub
  ON public.pagarme_status_history(subscription_id);
CREATE INDEX IF NOT EXISTS idx_pagarme_status_history_company
  ON public.pagarme_status_history(company_id);
CREATE INDEX IF NOT EXISTS idx_pagarme_status_history_changed_at
  ON public.pagarme_status_history(changed_at DESC);

CREATE OR REPLACE FUNCTION public.fn_log_pagarme_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
begin
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.pagarme_status_history (subscription_id, company_id, old_status, new_status, reason)
    VALUES (NEW.id, NEW.company_id, NULL, NEW.status, 'insert');
    RETURN NEW;
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.pagarme_status_history (subscription_id, company_id, old_status, new_status, reason)
    VALUES (NEW.id, NEW.company_id, OLD.status, NEW.status, 'status_change');
  END IF;
  RETURN NEW;
end;
$$;

DROP TRIGGER IF EXISTS trg_pagarme_subs_status_audit ON public.pagarme_subscriptions;
CREATE TRIGGER trg_pagarme_subs_status_audit
  AFTER INSERT OR UPDATE OF status ON public.pagarme_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_pagarme_status_change();

REVOKE ALL ON FUNCTION public.fn_log_pagarme_status_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_log_pagarme_status_change() TO service_role;
$$;
ALTER FUNCTION public.rpc_platform_suspend_company(uuid, uuid, text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rpc_platform_suspend_company(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_platform_suspend_company(uuid, uuid, text, text, text, text, text, text) TO service_role;