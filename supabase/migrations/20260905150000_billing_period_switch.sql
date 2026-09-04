-- Frente 2 (troca de ciclo no /plano): mensal → anual pró-rateado (pay-to-switch).
-- Decisão do dono (2026-09-04): rateia o já pago do mês corrente e cobra o anual
-- menos esse crédito; ao pagar, a assinatura vira anual e o ciclo reinicia (+1 ano).
--
-- Dinheiro/período no banco (governança Regra 2 / ADR-0006 D9/D10/D12):
--   credit  = fn_billing_prorate_cents(mensal_efetivo, dias_restantes<=30, 30)
--   annual  = fn_billing_year_price_cents(...) + extras_anuais (opção A)
--   amount  = max(0, annual - credit)
-- App só chama a RPC de quote e grava o amount calculado; nunca envia valor.

-- ---------------------------------------------------------------------------
-- 1) rpc_quote_period_switch — cotação mensal→anual (só active + billing_period=month)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_quote_period_switch(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.pagarme_subscriptions%rowtype;
  v_plan text;
  v_plan_row public.plans%rowtype;
  v_included int;
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

  v_plan := lower(coalesce(v_sub.plan::text, v_sub.plan_key, 'essencial'));
  v_plan := case v_plan
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else v_plan end;
  select * into v_plan_row from public.plans where key = v_plan limit 1;
  if not found then
    raise exception 'plan_not_found: %', v_plan using errcode = 'P0001';
  end if;

  v_included := greatest(1, coalesce(v_plan_row.included_seats, 1));
  v_seats := greatest(v_included, coalesce(nullif(v_sub.seat_quantity, 0), v_included));
  v_extras := greatest(0, v_seats - v_included);

  -- Mensal efetivo de lista (plano + seats extras) — base do crédito do mês corrente.
  v_monthly := public.fn_billing_monthly_charge_cents(
    v_plan_row.price_cents, v_included, v_seats, v_plan_row.seat_extra_cents);

  -- Anual canônico + extras anuais (opção A: seat_extra_cents*12 por assento extra).
  v_year := public.fn_billing_year_price_cents(
    v_plan_row.price_cents, v_plan_row.price_year_cents,
    v_plan_row.yearly_discount_mode, v_plan_row.yearly_discount_value);
  if v_extras > 0 and coalesce(v_plan_row.seat_extra_cents, 0) > 0 then
    v_annual := v_year + v_extras * (v_plan_row.seat_extra_cents * 12);
  else
    v_annual := v_year;
  end if;

  -- Crédito = parte não usada do mês já pago; nunca mais que um ciclo mensal.
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
    'plan', v_plan,
    'seat_quantity', v_seats,
    'next_billing_at', v_sub.next_billing_at,
    'applied_free', (v_amount <= 0)
  );
end;
$$;

revoke all on function public.rpc_quote_period_switch(uuid) from public;
revoke all on function public.rpc_quote_period_switch(uuid) from anon;
revoke all on function public.rpc_quote_period_switch(uuid) from authenticated;
grant execute on function public.rpc_quote_period_switch(uuid) to service_role;

comment on function public.rpc_quote_period_switch(uuid) is
  'ADR-0006 D12: cotacao mensal->anual (annual - credito do mes corrente). Amount canonico no banco.';

-- ---------------------------------------------------------------------------
-- 2) rpc_fulfill_obligation — recriação com branch period_switch.
--    Única mudança funcional vs 20260905131000: ao pagar kind=period_switch,
--    flip billing_period='year' + next_billing_at = paid_at + 1 ano (reinicia ciclo).
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
    -- Troca de ciclo: vira anual e reinicia o ciclo (+1 ano a partir do pagamento).
    v_next := public.fn_billing_next_due(v_paid_at, 'year');
    update public.pagarme_subscriptions
    set billing_period = 'year',
        status = 'active'::public.pagarme_sub_status,
        last_paid_at = v_paid_at,
        next_billing_at = v_next,
        activated_at = coalesce(activated_at, v_paid_at),
        pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
        pending_plan_key = null, pending_plan_change_at = null, pending_keep_user_ids = null,
        updated_at = v_paid_at
    where id = v_sub.id;

    update public.companies set is_active = true where id = v_claimed.company_id;

    return jsonb_build_object('status', 'fulfilled', 'kind', 'period_switch', 'claimed', true,
      'invoice_id', v_claimed.id, 'company_id', v_claimed.company_id, 'subscription_id', v_sub.id,
      'billing_period', 'year', 'order_id', p_pagarme_order_id,
      'next_billing_at', v_next, 'paid_at', v_paid_at);
  end if;

  -- renew / setup legado: aplica downgrade pendente primeiro
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

  -- D10: período-aware (mensal → +1 mês; anual → +1 ano)
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
  'Claim invoice; seat_add; plan_upgrade; period_switch (mensal->anual); pending downgrade; renew + promo. next_billing period-aware.';
