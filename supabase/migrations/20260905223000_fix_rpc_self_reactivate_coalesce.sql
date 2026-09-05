-- Fix: COALESCE(text, subscription_plan) — cast enum para text.

create or replace function public.rpc_self_reactivate_subscription(
  p_company_id uuid,
  p_plan_key text default null,
  p_caller_user_id uuid default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user_id   uuid := coalesce(p_caller_user_id, auth.uid());
  v_is_owner  boolean;
  v_sub       record;
  v_now       timestamptz := now();
  v_trial_end timestamptz;
  v_cooldown  interval := interval '60 days';
  v_plan_key  text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = p_company_id
      and cu.user_id    = v_user_id
      and cu.role       = 'owner'
      and cu.is_active  = true
  ) into v_is_owner;

  if not v_is_owner then
    raise exception 'forbidden: not_owner';
  end if;

  select * into v_sub
  from public.pagarme_subscriptions
  where company_id = p_company_id
  for update;

  if v_sub.id is null then
    raise exception 'subscription_not_found';
  end if;

  -- Conta nova (pay-to-start) paga em /plano/pagar — reativação só pós-abandono/inatividade.
  if v_sub.status not in ('abandoned', 'blocked', 'cancelled') then
    raise exception 'invalid_status_for_reactivation: current status is %', v_sub.status;
  end if;

  if v_sub.abandoned_at is not null
     and v_sub.abandoned_at > v_now - v_cooldown
     and coalesce(v_sub.self_reactivation_count, 0) > 0 then
    raise exception 'reactivation_cooldown_active: wait until %',
      (v_sub.abandoned_at + v_cooldown)::date;
  end if;

  v_plan_key := coalesce(nullif(btrim(p_plan_key), ''), v_sub.plan_key, v_sub.plan::text);

  v_trial_end := v_now + (
    case
      when v_plan_key = 'essencial' then interval '14 days'
      else interval '7 days'
    end
  );

  update public.pagarme_subscriptions
  set
    status                  = 'trial',
    trial_ends_at           = v_trial_end,
    activated_at            = coalesce(activated_at, v_now),
    abandoned_at            = null,
    self_reactivation_count = coalesce(self_reactivation_count, 0) + 1,
    last_status_change_at   = v_now,
    updated_at              = v_now
  where id = v_sub.id;

  update public.companies
  set is_active  = true,
      updated_at = v_now
  where id = p_company_id;

  return v_trial_end;
end;
$fn$;

alter function public.rpc_self_reactivate_subscription(uuid, text, uuid) owner to postgres;
revoke all on function public.rpc_self_reactivate_subscription(uuid, text, uuid) from public;
grant execute on function public.rpc_self_reactivate_subscription(uuid, text, uuid) to service_role;
