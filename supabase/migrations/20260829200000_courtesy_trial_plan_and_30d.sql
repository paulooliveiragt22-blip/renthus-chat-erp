-- A5.2+: Courtesy trial — escolha de plano + 1..30 dias.
-- Substitui a versão 14-dias-only sem plano. Mantém compatibilidade com a RPC antiga
-- (drop + recreate) e preserva o audit log intacto. Superadmin only (enforcement na API).
--
-- Mudanças:
--  * Aceita p_plan_key (essencial | pro | market) e persiste em pagarme_subscriptions.plan.
--  * Valida p_days entre 1 e 30 (antes 1..14).
--  * Cria pagarme_subscriptions se a empresa nunca teve (e.g. tenant órfão do legado).
--  * Sincroniza subscriptions.plan_id (legado) com o plano escolhido.
--  * Audit log inclui plan_key e days.

create or replace function public.rpc_platform_grant_courtesy_trial(
  p_company_id   uuid,
  p_days         integer,
  p_plan_key     text,
  p_actor_id     uuid,
  p_actor_email  text,
  p_actor_role   text,
  p_request_id   text,
  p_ip_address   text,
  p_user_agent   text,
  p_reason       text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub        record;
  v_plan_id    uuid;
  v_before     jsonb;
  v_after      jsonb;
  v_trial_end  timestamptz;
  v_plan_key   text;
begin
  if p_company_id is null then
    raise exception 'company_id required';
  end if;

  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'courtesy trial days must be between 1 and 30';
  end if;

  v_plan_key := lower(trim(coalesce(p_plan_key, '')));
  if v_plan_key not in ('essencial', 'pro', 'market') then
    raise exception 'plan_key_invalid: %, esperado essencial|pro|market', v_plan_key;
  end if;

  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'company_not_found';
  end if;

  select id into v_plan_id from public.plans where key = v_plan_key limit 1;
  if v_plan_id is null then
    raise exception 'plan_not_found: %', v_plan_key;
  end if;

  -- Lock do registro atual (se existir) — nunca pagou.
  select id, company_id, plan, status, trial_ends_at, last_paid_at, activated_at
    into v_sub
    from public.pagarme_subscriptions
   where company_id = p_company_id
   for update;

  if v_sub.id is not null and v_sub.last_paid_at is not null then
    raise exception 'company_already_paid';
  end if;

  v_trial_end := now() + (p_days || ' days')::interval;

  v_before := case when v_sub.id is null then jsonb_build_object('existed', false)
                   else jsonb_build_object(
                          'existed', true,
                          'status', v_sub.status,
                          'plan', v_sub.plan,
                          'trial_ends_at', v_sub.trial_ends_at,
                          'last_paid_at', v_sub.last_paid_at)
              end;

  if v_sub.id is null then
    -- Tenant órfão: cria a pagarme_subscriptions já em trial.
    insert into public.pagarme_subscriptions (
      company_id, plan, status, trial_ends_at, activated_at
    ) values (
      p_company_id,
      v_plan_key::public.subscription_plan,
      'trial'::public.pagarme_sub_status,
      v_trial_end,
      now()
    );
  else
    update public.pagarme_subscriptions
       set plan = v_plan_key::public.subscription_plan,
           status = 'trial'::public.pagarme_sub_status,
           trial_ends_at = v_trial_end,
           activated_at = coalesce(v_sub.activated_at, now()),
           updated_at = now()
     where id = v_sub.id;
  end if;

  -- Libera a empresa (paywall proxy checa pagarme_subscriptions.status).
  update public.companies
     set is_active = true
   where id = p_company_id;

  -- Sincroniza a tabela legada `subscriptions` (P0/D2 — gates de plano).
  update public.subscriptions
     set plan_id = v_plan_id,
         status = 'active',
         started_at = coalesce(started_at, now())
   where company_id = p_company_id
     and status = 'active';

  if not found then
    insert into public.subscriptions (company_id, plan_id, status, started_at)
    values (p_company_id, v_plan_id, 'active', now());
  end if;

  v_after := jsonb_build_object(
    'status', 'trial',
    'plan', v_plan_key,
    'trial_ends_at', v_trial_end,
    'courtesy_days', p_days
  );

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.billing.courtesy_trial_granted', 'company', p_company_id::text,
    p_company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object(
      'reason', coalesce(p_reason, ''),
      'days', p_days,
      'plan_key', v_plan_key,
      'source', 'manual_superadmin'
    ),
    'success'
  );

  return v_trial_end;
end;
$$;

revoke all on function public.rpc_platform_grant_courtesy_trial(
  uuid, integer, text, uuid, text, text, text, text, text, text
) from public;

grant execute on function public.rpc_platform_grant_courtesy_trial(
  uuid, integer, text, uuid, text, text, text, text, text, text
) to service_role;
