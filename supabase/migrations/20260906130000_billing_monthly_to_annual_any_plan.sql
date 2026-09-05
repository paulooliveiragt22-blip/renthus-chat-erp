-- Matriz de migração (dono 2026-09-05):
--  * Downgrade no MESMO ciclo (mensal→mensal ou anual→anual inferior): só no fim do ciclo.
--  * Anual só migra para anual (upgrade imediato; downgrade no fim).
--  * Mensal → anual (mesmo / superior / inferior): IMEDIATO com pró-rata
--    (annual(destino) − crédito do mês atual). Não espera o fim do mês.
--
-- Esta migration: quote aceita target inferior; fulfill aplica keep_users + seat cap
-- no period_switch quando há pending_keep_user_ids.

-- ---------------------------------------------------------------------------
-- 1) rpc_quote_period_switch — remove bloqueio not_an_upgrade (permite inferior)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_quote_period_switch(
  p_company_id uuid,
  p_target_plan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.pagarme_subscriptions%rowtype;
  v_from text;
  v_to text;
  v_from_row public.plans%rowtype;
  v_to_row public.plans%rowtype;
  v_included_from int;
  v_included_to int;
  v_seats int;
  v_extras int;
  v_monthly int;
  v_year int;
  v_annual int;
  v_credit int;
  v_days int;
  v_amount int;
  v_rank_from int;
  v_rank_to int;
begin
  select * into v_sub from public.pagarme_subscriptions where company_id = p_company_id limit 1;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;
  if v_sub.status::text <> 'active' then
    raise exception 'subscription_not_eligible' using errcode = 'P0001';
  end if;
  if lower(coalesce(v_sub.billing_period, 'month')) <> 'month' then
    raise exception 'already_annual' using errcode = 'P0001';
  end if;

  v_from := lower(coalesce(v_sub.plan::text, v_sub.plan_key, 'essencial'));
  v_from := case v_from
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else v_from end;
  if v_from not in ('essencial', 'pro', 'market') then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  v_to := lower(btrim(coalesce(p_target_plan, '')));
  if v_to = '' then
    v_to := v_from;
  else
    v_to := case v_to
      when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
      else v_to end;
  end if;
  if v_to not in ('essencial', 'pro', 'market') then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  -- Mensal→anual: qualquer destino (superior, igual ou inferior). Sem wait.
  v_rank_from := case v_from when 'essencial' then 0 when 'pro' then 1 else 2 end;
  v_rank_to   := case v_to   when 'essencial' then 0 when 'pro' then 1 else 2 end;

  select * into v_from_row from public.plans where key = v_from limit 1;
  select * into v_to_row   from public.plans where key = v_to   limit 1;
  if v_from_row.key is null or v_to_row.key is null then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  v_included_from := greatest(1, coalesce(v_from_row.included_seats, 1));
  v_included_to   := greatest(1, coalesce(v_to_row.included_seats, 1));

  -- Seats no destino: em upgrade sobe ao included; em downgrade usa included do destino
  -- (extras só se seat_quantity atual > included destino — raro em Essencial).
  if v_rank_to >= v_rank_from then
    v_seats := greatest(v_included_from, coalesce(nullif(v_sub.seat_quantity, 0), v_included_from));
    v_seats := greatest(v_seats, v_included_to);
  else
    v_seats := v_included_to;
  end if;
  v_extras := greatest(0, v_seats - v_included_to);

  v_monthly := public.fn_billing_monthly_charge_cents(
    v_from_row.price_cents, v_included_from,
    greatest(v_included_from, coalesce(nullif(v_sub.seat_quantity, 0), v_included_from)),
    v_from_row.seat_extra_cents);

  v_year := public.fn_billing_year_price_cents(
    v_to_row.price_cents, v_to_row.price_year_cents,
    v_to_row.yearly_discount_mode, v_to_row.yearly_discount_value);
  if v_extras > 0 and coalesce(v_to_row.seat_extra_cents, 0) > 0 then
    v_annual := v_year + v_extras * (v_to_row.seat_extra_cents * 12);
  else
    v_annual := v_year;
  end if;

  if v_sub.next_billing_at is null then
    v_days := 30;
  else
    v_days := greatest(0, ceil(extract(epoch from (v_sub.next_billing_at - now())) / 86400.0)::int);
  end if;
  if v_days > 30 then
    v_days := 30;
  end if;

  v_credit := public.fn_billing_prorate_cents(v_monthly, v_days, 30);
  v_amount := greatest(0, v_annual - v_credit);

  return jsonb_build_object(
    'amount_cents', v_amount,
    'annual_cents', v_annual,
    'monthly_cents', v_monthly,
    'credit_cents', v_credit,
    'days_left', v_days,
    'plan', v_to,
    'from_plan', v_from,
    'to_plan', v_to,
    'seat_quantity', v_seats,
    'rank_delta', v_rank_to - v_rank_from,
    'next_billing_at', v_sub.next_billing_at,
    'applied_free', (v_amount <= 0),
    'combined_upgrade', (v_to <> v_from)
  );
end;
$$;

revoke all on function public.rpc_quote_period_switch(uuid, text) from public;
revoke all on function public.rpc_quote_period_switch(uuid, text) from anon;
revoke all on function public.rpc_quote_period_switch(uuid, text) from authenticated;
grant execute on function public.rpc_quote_period_switch(uuid, text) to service_role;

comment on function public.rpc_quote_period_switch(uuid, text) is
  'Mensal→anual imediato (pró-rata): destino pode ser igual, superior ou inferior. Amount = annual(to) - credit(from month).';

-- ---------------------------------------------------------------------------
-- 2) rpc_resolve_keep_user_ids — validação keep reutilizável (schedule + switch)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_resolve_keep_user_ids(
  p_company_id    uuid,
  p_target_plan   text,
  p_keep_user_ids uuid[] default '{}'
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target text;
  v_included int;
  v_active_total int;
  v_req uuid[] := coalesce(p_keep_user_ids, '{}');
  v_req_valid uuid[];
  v_all_active uuid[];
  v_keep uuid[];
  v_has_admin boolean;
begin
  v_target := lower(btrim(coalesce(p_target_plan, '')));
  if v_target not in ('essencial', 'pro', 'market') then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  select greatest(1, coalesce(included_seats, 1)) into v_included
  from public.plans where key = v_target limit 1;
  if v_included is null then
    v_included := 1;
  end if;

  select array(
    select cu.user_id from public.company_users cu
    where cu.company_id = p_company_id and cu.is_active = true
  ) into v_all_active;
  v_active_total := coalesce(cardinality(v_all_active), 0);

  select array(
    select cu.user_id from public.company_users cu
    where cu.company_id = p_company_id and cu.is_active = true and cu.user_id = any(v_req)
  ) into v_req_valid;

  if v_active_total <= v_included then
    if coalesce(cardinality(v_req_valid), 0) > 0 then
      v_keep := v_req_valid;
    else
      v_keep := v_all_active;
    end if;
    if coalesce(cardinality(v_keep), 0) > v_included then
      raise exception 'select_at_most_% users', v_included using errcode = 'P0001';
    end if;
  else
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

  return coalesce(v_keep, '{}');
end;
$$;

revoke all on function public.rpc_resolve_keep_user_ids(uuid, text, uuid[]) from public;
revoke all on function public.rpc_resolve_keep_user_ids(uuid, text, uuid[]) from anon;
revoke all on function public.rpc_resolve_keep_user_ids(uuid, text, uuid[]) from authenticated;
grant execute on function public.rpc_resolve_keep_user_ids(uuid, text, uuid[]) to service_role;

-- schedule_downgrade passa a usar o resolver (mesmo contrato)
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
  v_keep uuid[];
  v_next timestamptz;
begin
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

  -- Anual→mensal não: downgrade agendado preserva ciclo; plano destino no fim.
  -- (Troca de período anual→mensal continua fora de escopo.)

  v_next := v_sub.next_billing_at;
  if v_next is null then
    raise exception 'no_next_billing' using errcode = 'P0001';
  end if;

  v_keep := public.rpc_resolve_keep_user_ids(p_company_id, v_target, p_keep_user_ids);

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

-- ---------------------------------------------------------------------------
-- 3) fulfill period_switch: aplica keep + seat = included do destino
-- ---------------------------------------------------------------------------
create or replace function public.rpc_fulfill_obligation(
  p_pagarme_order_id text,
  p_pagarme_customer_id text default null,
  p_meta_type text default null,
  p_meta_plan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.invoices%rowtype;
  v_claimed public.invoices%rowtype;
  v_sub public.pagarme_subscriptions%rowtype;
  v_paid_at timestamptz := now();
  v_next timestamptz;
  v_is_setup boolean;
  v_is_seat boolean;
  v_is_upgrade boolean;
  v_is_period_switch boolean;
  v_plan text;
  v_plan_id uuid;
  v_kind text;
  v_cid text;
  v_seats int;
  v_included int;
  v_promo_left int;
  v_pending_apply jsonb;
  v_deactivated int := 0;
  v_rank_from int;
  v_rank_to int;
  v_from text;
begin
  if p_pagarme_order_id is null or btrim(p_pagarme_order_id) = '' then
    raise exception 'pagarme_order_id required' using errcode = 'P0001';
  end if;

  select * into v_inv
  from public.invoices
  where pagarme_order_id = p_pagarme_order_id
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('status', 'not_found', 'order_id', p_pagarme_order_id);
  end if;

  v_is_setup := (v_inv.kind = 'setup') or (lower(coalesce(p_meta_type, '')) = 'setup');
  v_is_seat := (v_inv.kind = 'seat_add') or (lower(coalesce(p_meta_type, '')) = 'seat_add');
  v_is_upgrade := (v_inv.kind = 'plan_upgrade') or (lower(coalesce(p_meta_type, '')) = 'plan_upgrade');
  v_is_period_switch := (v_inv.kind = 'period_switch') or (lower(coalesce(p_meta_type, '')) = 'period_switch');

  v_kind := case
    when v_is_setup then 'setup'
    when v_is_seat then 'seat_add'
    when v_is_upgrade then 'plan_upgrade'
    when v_is_period_switch then 'period_switch'
    else 'invoice'
  end;

  if v_inv.status = 'paid' then
    return jsonb_build_object('status', 'already_done', 'kind', v_kind,
      'invoice_id', v_inv.id, 'company_id', v_inv.company_id, 'order_id', p_pagarme_order_id);
  end if;

  update public.invoices
  set status = 'paid', paid_at = v_paid_at
  where id = v_inv.id and status = 'pending'
  returning * into v_claimed;

  if not found then
    return jsonb_build_object('status', 'already_done', 'kind', v_kind,
      'invoice_id', v_inv.id, 'company_id', v_inv.company_id, 'order_id', p_pagarme_order_id);
  end if;

  select * into v_sub from public.pagarme_subscriptions where id = v_claimed.subscription_id limit 1;
  if not found then
    select * into v_sub from public.pagarme_subscriptions where company_id = v_claimed.company_id limit 1;
  end if;
  if not found then
    raise exception 'pagarme_subscription not found for company %', v_claimed.company_id using errcode = 'P0001';
  end if;

  v_cid := nullif(btrim(coalesce(p_pagarme_customer_id, '')), '');

  if v_is_seat then
    update public.pagarme_subscriptions
    set seat_quantity = greatest(1, coalesce(seat_quantity, 1)) + 1,
        pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
        updated_at = v_paid_at
    where id = v_sub.id
    returning seat_quantity into v_seats;

    update public.companies set is_active = true where id = v_claimed.company_id;

    return jsonb_build_object('status', 'fulfilled', 'kind', 'seat_add', 'claimed', true,
      'invoice_id', v_claimed.id, 'company_id', v_claimed.company_id, 'subscription_id', v_sub.id,
      'order_id', p_pagarme_order_id, 'seat_quantity', v_seats, 'paid_at', v_paid_at);
  end if;

  if v_is_upgrade then
    v_plan := nullif(btrim(coalesce(v_claimed.target_plan_key, p_meta_plan, '')), '');
    if v_plan is null or btrim(v_plan) = '' then
      raise exception 'plan_upgrade missing target plan for order %', p_pagarme_order_id using errcode = 'P0001';
    end if;
    v_plan := case lower(v_plan)
      when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
      else lower(v_plan) end;

    select id, coalesce(included_seats, 1) into v_plan_id, v_included
    from public.plans where key = v_plan limit 1;
    if v_plan_id is null then
      raise exception 'plan % not found', v_plan using errcode = 'P0001';
    end if;

    update public.pagarme_subscriptions
    set plan = v_plan::public.subscription_plan, plan_key = v_plan, plan_id = v_plan_id,
        seat_quantity = greatest(coalesce(seat_quantity, 1), v_included),
        status = 'active'::public.pagarme_sub_status,
        pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
        pending_plan_key = null, pending_plan_change_at = null, pending_keep_user_ids = null,
        pending_upgrade_plan_key = null, pending_checkout_intent = null,
        updated_at = v_paid_at
    where id = v_sub.id
    returning seat_quantity into v_seats;

    update public.companies set is_active = true where id = v_claimed.company_id;

    return jsonb_build_object('status', 'fulfilled', 'kind', 'plan_upgrade', 'claimed', true,
      'invoice_id', v_claimed.id, 'company_id', v_claimed.company_id, 'subscription_id', v_sub.id,
      'plan', v_plan, 'order_id', p_pagarme_order_id, 'seat_quantity', v_seats,
      'paid_at', v_paid_at, 'next_billing_at', v_sub.next_billing_at);
  end if;

  if v_is_period_switch then
    v_next := public.fn_billing_next_due(v_paid_at, 'year');
    v_from := lower(coalesce(v_sub.plan::text, v_sub.plan_key, 'essencial'));
    v_from := case v_from
      when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
      else v_from end;

    v_plan := nullif(btrim(coalesce(v_claimed.target_plan_key, p_meta_plan, '')), '');
    if v_plan is null or btrim(v_plan) = '' then
      v_plan := v_from;
    end if;
    v_plan := case lower(v_plan)
      when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
      else lower(v_plan) end;

    select id, coalesce(included_seats, 1) into v_plan_id, v_included
    from public.plans where key = v_plan limit 1;

    v_rank_from := case v_from when 'essencial' then 0 when 'pro' then 1 else 2 end;
    v_rank_to   := case v_plan when 'essencial' then 0 when 'pro' then 1 else 2 end;

    -- Downgrade mensal→anual: aplica keep imediatamente.
    if v_rank_to < v_rank_from and v_sub.pending_keep_user_ids is not null then
      update public.company_users
      set is_active = false
      where company_id = v_claimed.company_id
        and coalesce(is_active, true) = true
        and not (user_id = any (v_sub.pending_keep_user_ids));
      get diagnostics v_deactivated = row_count;
      v_seats := greatest(1, coalesce(v_included, 1));
    elsif v_rank_to < v_rank_from then
      v_seats := greatest(1, coalesce(v_included, 1));
    else
      v_seats := greatest(coalesce(v_sub.seat_quantity, 1), coalesce(v_included, 1));
    end if;

    update public.pagarme_subscriptions
    set billing_period = 'year',
        plan = v_plan::public.subscription_plan,
        plan_key = v_plan,
        plan_id = coalesce(v_plan_id, plan_id),
        seat_quantity = v_seats,
        status = 'active'::public.pagarme_sub_status,
        last_paid_at = v_paid_at,
        next_billing_at = v_next,
        activated_at = coalesce(activated_at, v_paid_at),
        pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
        pending_plan_key = null, pending_plan_change_at = null, pending_keep_user_ids = null,
        pending_upgrade_plan_key = null, pending_checkout_intent = null,
        updated_at = v_paid_at
    where id = v_sub.id;

    update public.companies set is_active = true where id = v_claimed.company_id;

    return jsonb_build_object('status', 'fulfilled', 'kind', 'period_switch', 'claimed', true,
      'invoice_id', v_claimed.id, 'company_id', v_claimed.company_id, 'subscription_id', v_sub.id,
      'billing_period', 'year', 'plan', v_plan, 'order_id', p_pagarme_order_id,
      'seat_quantity', v_seats, 'users_deactivated', v_deactivated,
      'next_billing_at', v_next, 'paid_at', v_paid_at);
  end if;

  v_pending_apply := public.rpc_apply_pending_plan_change(v_sub.id);
  select * into v_sub from public.pagarme_subscriptions where id = v_sub.id;

  v_plan := nullif(btrim(coalesce(p_meta_plan, '')), '');
  if v_plan is null then
    v_plan := coalesce(v_sub.plan::text, v_sub.plan_key);
  end if;
  if (v_pending_apply->>'status') = 'applied' then
    v_plan := coalesce(v_sub.plan::text, v_sub.plan_key, v_plan);
  end if;
  if v_plan is null or btrim(v_plan) = '' then
    raise exception 'plan missing for order %', p_pagarme_order_id using errcode = 'P0001';
  end if;
  v_plan := case lower(v_plan)
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else lower(v_plan) end;

  v_next := public.fn_billing_next_due(v_paid_at, coalesce(v_sub.billing_period, 'month'));

  select id into v_plan_id from public.plans where key = v_plan limit 1;

  v_promo_left := null;
  if coalesce(v_sub.billing_period, 'month') = 'month'
     and coalesce(v_sub.promo_months_remaining, 0) > 0 then
    v_promo_left := greatest(0, v_sub.promo_months_remaining - 1);
  end if;

  update public.pagarme_subscriptions
  set plan = v_plan::public.subscription_plan, plan_key = v_plan,
      plan_id = coalesce(v_plan_id, plan_id),
      status = 'active'::public.pagarme_sub_status,
      last_paid_at = v_paid_at, next_billing_at = v_next,
      activated_at = coalesce(activated_at, v_paid_at),
      pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
      promo_months_remaining = case
        when v_promo_left is null then promo_months_remaining
        when v_promo_left = 0 then 0 else v_promo_left end,
      promo_id = case when v_promo_left = 0 then null else promo_id end,
      pending_upgrade_plan_key = null, pending_checkout_intent = null,
      updated_at = v_paid_at
  where id = v_sub.id;

  update public.companies set is_active = true where id = v_claimed.company_id;

  return jsonb_build_object('status', 'fulfilled', 'kind', v_kind, 'claimed', true,
    'invoice_id', v_claimed.id, 'company_id', v_claimed.company_id, 'subscription_id', v_sub.id,
    'plan', v_plan, 'order_id', p_pagarme_order_id, 'next_billing_at', v_next,
    'paid_at', v_paid_at, 'promo_months_remaining', v_promo_left, 'pending_plan_apply', v_pending_apply);
end;
$$;

revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from public;
revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from anon;
revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from authenticated;
grant execute on function public.rpc_fulfill_obligation(text, text, text, text) to service_role;

comment on function public.rpc_fulfill_obligation(text, text, text, text) is
  'Claim; seat_add; plan_upgrade; period_switch (mensal→anual qualquer destino + keep); renew.';
