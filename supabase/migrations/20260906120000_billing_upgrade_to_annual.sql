-- Fluxo combinado: upgrade de plano + migração mensal→anual num único pagamento.
-- Decisão dono 2026-09-05: card "Market anual" deve cotar anual(destino) − crédito do mês atual.
-- Amount canônico no DB (ADR-0006 D9/D12). App só passa target_plan.

-- ---------------------------------------------------------------------------
-- 1) Intent: upgrade_to_annual
-- ---------------------------------------------------------------------------
alter table public.pagarme_subscriptions
  drop constraint if exists pagarme_subscriptions_pending_checkout_intent_check;

alter table public.pagarme_subscriptions
  add constraint pagarme_subscriptions_pending_checkout_intent_check
  check (
    pending_checkout_intent is null
    or pending_checkout_intent in ('period_switch', 'upgrade_to_annual')
  );

comment on column public.pagarme_subscriptions.pending_checkout_intent is
  'Checkout pendente sem invoice: period_switch (mesmo plano) | upgrade_to_annual (plano maior + anual).';

-- ---------------------------------------------------------------------------
-- 2) rpc_quote_period_switch(company, target_plan?)
--    target null/igual → R2-5 puro. target maior → anual(destino) − crédito(mensal atual).
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_quote_period_switch(uuid);

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
  v_rank_from int;
  v_rank_to int;
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

  v_rank_from := case v_from when 'essencial' then 0 when 'pro' then 1 else 2 end;
  v_rank_to   := case v_to   when 'essencial' then 0 when 'pro' then 1 else 2 end;
  if v_rank_to < v_rank_from then
    raise exception 'not_an_upgrade' using errcode = 'P0001';
  end if;

  select * into v_from_row from public.plans where key = v_from limit 1;
  select * into v_to_row   from public.plans where key = v_to   limit 1;
  if v_from_row.key is null or v_to_row.key is null then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  v_included_from := greatest(1, coalesce(v_from_row.included_seats, 1));
  v_included_to   := greatest(1, coalesce(v_to_row.included_seats, 1));
  v_seats := greatest(v_included_from, coalesce(nullif(v_sub.seat_quantity, 0), v_included_from));
  -- No destino: seats sobem ao included do plano novo (ex. Market 10).
  v_seats := greatest(v_seats, v_included_to);
  v_extras := greatest(0, v_seats - v_included_to);

  -- Crédito = parte não usada do mês já pago do plano ATUAL (não do destino).
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
  'Mensal→anual: annual(destino) - credito(mes atual). target null = mesmo plano (R2-5); target maior = upgrade+anual.';

-- ---------------------------------------------------------------------------
-- 3) rpc_ensure_period_switch_obligation(company, target_plan?)
-- ---------------------------------------------------------------------------
drop function if exists public.rpc_ensure_period_switch_obligation(uuid);

create or replace function public.rpc_ensure_period_switch_obligation(
  p_company_id uuid,
  p_target_plan text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote jsonb;
  v_sub public.pagarme_subscriptions%rowtype;
  v_amount_cents int;
  v_annual_cents int;
  v_credit_cents int;
  v_plan text;
  v_from_plan text;
  v_applied_free boolean;
  v_existing public.invoices%rowtype;
  v_new public.invoices%rowtype;
  v_brl numeric;
  v_next timestamptz;
  v_plan_id uuid;
  v_included int;
  v_seats int;
  v_target text;
  v_need_reset boolean;
begin
  v_quote := public.rpc_quote_period_switch(p_company_id, p_target_plan);
  v_amount_cents := greatest(0, coalesce((v_quote->>'amount_cents')::int, 0));
  v_annual_cents := greatest(0, coalesce((v_quote->>'annual_cents')::int, 0));
  v_credit_cents := greatest(0, coalesce((v_quote->>'credit_cents')::int, 0));
  v_plan := coalesce(v_quote->>'plan', 'essencial');
  v_from_plan := coalesce(v_quote->>'from_plan', v_plan);
  v_applied_free := coalesce((v_quote->>'applied_free')::boolean, false) or v_amount_cents <= 0;
  v_seats := greatest(1, coalesce((v_quote->>'seat_quantity')::int, 1));

  select * into v_sub
  from public.pagarme_subscriptions
  where company_id = p_company_id
  limit 1;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;

  if v_applied_free then
    v_next := public.fn_billing_next_due(now(), 'year');
    select id, coalesce(included_seats, 1) into v_plan_id, v_included
    from public.plans where key = v_plan limit 1;
    update public.pagarme_subscriptions
    set billing_period = 'year',
        plan = v_plan::public.subscription_plan,
        plan_key = v_plan,
        plan_id = coalesce(v_plan_id, plan_id),
        seat_quantity = greatest(coalesce(seat_quantity, 1), coalesce(v_included, 1), v_seats),
        next_billing_at = v_next,
        last_paid_at = now(),
        pending_upgrade_plan_key = null,
        pending_checkout_intent = null,
        pending_plan_key = null,
        pending_plan_change_at = null,
        pending_keep_user_ids = null,
        updated_at = now()
    where id = v_sub.id;
    return jsonb_build_object(
      'status', 'applied_free',
      'applied_free', true,
      'plan', v_plan,
      'from_plan', v_from_plan,
      'amount_cents', 0,
      'annual_cents', v_annual_cents,
      'credit_cents', v_credit_cents,
      'next_billing_at', v_next
    );
  end if;

  v_brl := (v_amount_cents::numeric / 100);

  select * into v_existing
  from public.invoices
  where company_id = p_company_id
    and kind = 'period_switch'
    and status = 'pending'
  limit 1;

  if found then
    v_target := case when v_plan <> v_from_plan then v_plan else null end;
    v_need_reset :=
      abs(coalesce(v_existing.amount, 0) - v_brl) > 0.02
      or coalesce(v_existing.target_plan_key, '') is distinct from coalesce(v_target, '');
    update public.invoices
    set amount = v_brl,
        target_plan_key = v_target,
        pagarme_order_id = case when v_need_reset then null else pagarme_order_id end,
        pagarme_payment_url = case when v_need_reset then null else pagarme_payment_url end,
        pix_qr_code = case when v_need_reset then null else pix_qr_code end
    where id = v_existing.id
      and status = 'pending'
    returning * into v_existing;

    return jsonb_build_object(
      'status', 'exists',
      'applied_free', false,
      'invoice_id', v_existing.id,
      'company_id', p_company_id,
      'kind', 'period_switch',
      'plan', v_plan,
      'from_plan', v_from_plan,
      'amount_cents', v_amount_cents,
      'annual_cents', v_annual_cents,
      'credit_cents', v_credit_cents,
      'pagarme_order_id', v_existing.pagarme_order_id,
      'created', false
    );
  end if;

  begin
    insert into public.invoices (
      company_id, subscription_id, amount, status, kind, due_at,
      target_plan_key,
      pagarme_order_id, pagarme_payment_url, pix_qr_code
    ) values (
      p_company_id, v_sub.id, v_brl, 'pending', 'period_switch', now(),
      case when v_plan <> v_from_plan then v_plan else null end,
      null, null, null
    )
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing
    from public.invoices
    where company_id = p_company_id
      and kind = 'period_switch'
      and status = 'pending'
    limit 1;
    return jsonb_build_object(
      'status', 'exists',
      'applied_free', false,
      'invoice_id', v_existing.id,
      'company_id', p_company_id,
      'kind', 'period_switch',
      'plan', v_plan,
      'from_plan', v_from_plan,
      'amount_cents', v_amount_cents,
      'annual_cents', v_annual_cents,
      'credit_cents', v_credit_cents,
      'pagarme_order_id', v_existing.pagarme_order_id,
      'created', false
    );
  end;

  return jsonb_build_object(
    'status', 'created',
    'applied_free', false,
    'invoice_id', v_new.id,
    'company_id', p_company_id,
    'subscription_id', v_sub.id,
    'kind', 'period_switch',
    'plan', v_plan,
    'from_plan', v_from_plan,
    'amount_cents', v_amount_cents,
    'annual_cents', v_annual_cents,
    'credit_cents', v_credit_cents,
    'pagarme_order_id', null,
    'created', true
  );
end;
$$;

revoke all on function public.rpc_ensure_period_switch_obligation(uuid, text) from public;
revoke all on function public.rpc_ensure_period_switch_obligation(uuid, text) from anon;
revoke all on function public.rpc_ensure_period_switch_obligation(uuid, text) from authenticated;
grant execute on function public.rpc_ensure_period_switch_obligation(uuid, text) to service_role;

comment on function public.rpc_ensure_period_switch_obligation(uuid, text) is
  'Cria/reusa invoice period_switch; target_plan opcional grava target_plan_key (upgrade+anual).';

-- ---------------------------------------------------------------------------
-- 4) fulfill period_switch: aplica target_plan_key + limpa intents
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
    v_plan := nullif(btrim(coalesce(v_claimed.target_plan_key, p_meta_plan, '')), '');
    if v_plan is null or btrim(v_plan) = '' then
      v_plan := coalesce(v_sub.plan::text, v_sub.plan_key);
    end if;
    v_plan := case lower(v_plan)
      when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
      else lower(v_plan) end;

    select id, coalesce(included_seats, 1) into v_plan_id, v_included
    from public.plans where key = v_plan limit 1;

    update public.pagarme_subscriptions
    set billing_period = 'year',
        plan = v_plan::public.subscription_plan,
        plan_key = v_plan,
        plan_id = coalesce(v_plan_id, plan_id),
        seat_quantity = greatest(coalesce(seat_quantity, 1), coalesce(v_included, 1)),
        status = 'active'::public.pagarme_sub_status,
        last_paid_at = v_paid_at,
        next_billing_at = v_next,
        activated_at = coalesce(activated_at, v_paid_at),
        pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
        pending_plan_key = null, pending_plan_change_at = null, pending_keep_user_ids = null,
        pending_upgrade_plan_key = null, pending_checkout_intent = null,
        updated_at = v_paid_at
    where id = v_sub.id
    returning seat_quantity into v_seats;

    update public.companies set is_active = true where id = v_claimed.company_id;

    return jsonb_build_object('status', 'fulfilled', 'kind', 'period_switch', 'claimed', true,
      'invoice_id', v_claimed.id, 'company_id', v_claimed.company_id, 'subscription_id', v_sub.id,
      'billing_period', 'year', 'plan', v_plan, 'order_id', p_pagarme_order_id,
      'seat_quantity', v_seats, 'next_billing_at', v_next, 'paid_at', v_paid_at);
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
  'Claim invoice; seat_add; plan_upgrade; period_switch (+target_plan_key upgrade-to-annual); renew. Clears checkout intents.';
