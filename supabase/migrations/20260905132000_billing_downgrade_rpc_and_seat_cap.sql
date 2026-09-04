-- Endurecimento total — Pacote 3 (ADR-0006 D11 / rule governanca Regra 2):
--  * rpc_schedule_downgrade: valida keep-users + rank + ciclo NO BANCO (F1).
--  * rpc_cancel_pending_plan_change: cancela agendamento.
--  * trigger seat cap em company_users: bloqueia race de convite (F5/BN-17).
-- Espelha scheduleDowngrade.ts + validateKeepUserSelection.ts (fonte passa p/ DB).

-- ---------------------------------------------------------------------------
-- 1) rpc_schedule_downgrade — BN-12 / R3-4
-- ---------------------------------------------------------------------------
create or replace function public.rpc_schedule_downgrade(
  p_company_id     uuid,
  p_target_plan    text,
  p_keep_user_ids  uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.pagarme_subscriptions%rowtype;
  v_target text;
  v_current text;
  v_rank_target int;
  v_rank_current int;
  v_included int;
  v_active_total int;
  v_req uuid[] := coalesce(p_keep_user_ids, '{}');
  v_req_valid uuid[];
  v_all_active uuid[];
  v_keep uuid[];
  v_has_admin boolean;
  v_next timestamptz;
begin
  -- target só keys comerciais (rejeita bot/complete/starter)
  v_target := lower(btrim(coalesce(p_target_plan, '')));
  if v_target not in ('essencial', 'pro', 'market') then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  select * into v_sub from public.pagarme_subscriptions where company_id = p_company_id limit 1;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;

  if v_sub.status::text <> 'active' then
    raise exception 'not_active' using errcode = 'P0001';
  end if;

  v_current := lower(coalesce(v_sub.plan::text, v_sub.plan_key, ''));
  v_current := case v_current
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else v_current end;
  if v_current not in ('essencial', 'pro', 'market') then
    raise exception 'current_plan_invalid' using errcode = 'P0001';
  end if;

  v_rank_target := case v_target when 'essencial' then 0 when 'pro' then 1 else 2 end;
  v_rank_current := case v_current when 'essencial' then 0 when 'pro' then 1 else 2 end;
  if v_rank_target >= v_rank_current then
    raise exception 'use_upgrade_flow' using errcode = 'P0001';
  end if;

  v_next := v_sub.next_billing_at;
  if v_next is null then
    raise exception 'no_next_billing' using errcode = 'P0001';
  end if;

  select greatest(1, coalesce(included_seats, 1)) into v_included
  from public.plans where key = v_target limit 1;
  if v_included is null then
    v_included := 1;
  end if;

  -- membros ativos da empresa
  select array(
    select cu.user_id from public.company_users cu
    where cu.company_id = p_company_id and cu.is_active = true
  ) into v_all_active;
  v_active_total := coalesce(cardinality(v_all_active), 0);

  -- requested ∩ ativos
  select array(
    select cu.user_id from public.company_users cu
    where cu.company_id = p_company_id and cu.is_active = true and cu.user_id = any(v_req)
  ) into v_req_valid;

  if v_active_total <= v_included then
    -- sem excesso: keep = requested válidos (se houver) senão todos ativos
    if coalesce(cardinality(v_req_valid), 0) > 0 then
      v_keep := v_req_valid;
    else
      v_keep := v_all_active;
    end if;
    if coalesce(cardinality(v_keep), 0) > v_included then
      raise exception 'select_at_most_% users', v_included using errcode = 'P0001';
    end if;
  else
    -- excesso: requested obrigatório, 1..included, todos ativos
    if coalesce(cardinality(v_req), 0) = 0 then
      raise exception 'select_up_to_% users (% active)', v_included, v_active_total using errcode = 'P0001';
    end if;
    if cardinality(v_req) > v_included then
      raise exception 'select_at_most_% users', v_included using errcode = 'P0001';
    end if;
    if coalesce(cardinality(v_req_valid), 0) <> cardinality(v_req) then
      raise exception 'selection_invalid_inactive_or_foreign' using errcode = 'P0001';
    end if;
    v_keep := v_req;
  end if;

  -- ≥1 admin/owner entre os mantidos (se houver algum ativo)
  if v_active_total > 0 then
    select exists(
      select 1 from public.company_users cu
      where cu.company_id = p_company_id and cu.is_active = true
        and cu.user_id = any(v_keep)
        and lower(cu.role) in ('owner', 'admin')
    ) into v_has_admin;
    if not v_has_admin then
      raise exception 'need_at_least_one_admin' using errcode = 'P0001';
    end if;
  end if;

  update public.pagarme_subscriptions
  set pending_plan_key = v_target,
      pending_plan_change_at = v_next,
      pending_keep_user_ids = v_keep,
      updated_at = now()
  where id = v_sub.id;

  return jsonb_build_object(
    'ok', true,
    'action', 'scheduled',
    'company_id', p_company_id,
    'pending_plan_key', v_target,
    'pending_plan_change_at', v_next,
    'keep_user_ids', to_jsonb(v_keep)
  );
end;
$$;

revoke all on function public.rpc_schedule_downgrade(uuid, text, uuid[]) from public;
revoke all on function public.rpc_schedule_downgrade(uuid, text, uuid[]) from anon;
revoke all on function public.rpc_schedule_downgrade(uuid, text, uuid[]) from authenticated;
grant execute on function public.rpc_schedule_downgrade(uuid, text, uuid[]) to service_role;

comment on function public.rpc_schedule_downgrade(uuid, text, uuid[]) is
  'ADR-0006 D11 / BN-12: agenda downgrade validando rank+ciclo+keep-users no banco.';

-- ---------------------------------------------------------------------------
-- 2) rpc_cancel_pending_plan_change
-- ---------------------------------------------------------------------------
create or replace function public.rpc_cancel_pending_plan_change(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.pagarme_subscriptions%rowtype;
begin
  select * into v_sub from public.pagarme_subscriptions where company_id = p_company_id limit 1;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;
  if v_sub.pending_plan_key is null then
    raise exception 'no_scheduled_change' using errcode = 'P0001';
  end if;

  update public.pagarme_subscriptions
  set pending_plan_key = null,
      pending_plan_change_at = null,
      pending_keep_user_ids = null,
      updated_at = now()
  where id = v_sub.id;

  return jsonb_build_object('ok', true, 'company_id', p_company_id, 'cancelled', true);
end;
$$;

revoke all on function public.rpc_cancel_pending_plan_change(uuid) from public;
revoke all on function public.rpc_cancel_pending_plan_change(uuid) from anon;
revoke all on function public.rpc_cancel_pending_plan_change(uuid) from authenticated;
grant execute on function public.rpc_cancel_pending_plan_change(uuid) to service_role;

comment on function public.rpc_cancel_pending_plan_change(uuid) is
  'ADR-0006 D11 / BN-12: cancela downgrade agendado.';

-- ---------------------------------------------------------------------------
-- 3) Seat cap trigger (F5 / BN-17): bloqueia race que o gate TS deixa passar.
--    Só enforça quando a operação ADICIONA um assento ativo (insert active ou
--    update inactive→active). Não quebra dados já acima do cap nem role updates.
--    Sem subscription → não enforça (empresa sem plano ainda).
-- ---------------------------------------------------------------------------
create or replace function public.trg_fn_company_users_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap int;
  v_plan text;
  v_included int;
  v_active int;
begin
  if tg_op = 'INSERT' then
    if new.is_active is not true then return new; end if;
  elsif tg_op = 'UPDATE' then
    if not (new.is_active is true and old.is_active is not true) then return new; end if;
  end if;

  select seat_quantity, lower(coalesce(plan::text, plan_key))
  into v_cap, v_plan
  from public.pagarme_subscriptions
  where company_id = new.company_id
  limit 1;
  if not found then
    return new;  -- sem plano: não enforça aqui
  end if;

  if v_cap is null or v_cap < 1 then
    select greatest(1, coalesce(included_seats, 1)) into v_included
    from public.plans
    where key = case v_plan
      when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
      else coalesce(v_plan, 'essencial') end
    limit 1;
    v_cap := coalesce(v_included, 1);
  end if;

  select count(*) into v_active
  from public.company_users
  where company_id = new.company_id and is_active = true and id <> new.id;

  if (v_active + 1) > v_cap then
    raise exception 'seat_limit_reached: % active would exceed capacity % (company %)',
      v_active + 1, v_cap, new.company_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.trg_fn_company_users_seat_cap() from public;

drop trigger if exists trg_company_users_seat_cap on public.company_users;
create trigger trg_company_users_seat_cap
  before insert or update on public.company_users
  for each row execute function public.trg_fn_company_users_seat_cap();

comment on function public.trg_fn_company_users_seat_cap() is
  'ADR-0006 D11 / BN-17: seat cap no banco; bloqueia ativar assento acima da capacidade.';
