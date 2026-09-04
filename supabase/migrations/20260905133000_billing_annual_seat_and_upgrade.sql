-- Endurecimento total — Pacote 4 (ADR-0006 D9/D12 / rule governanca Regra 2):
-- Modelo comercial ANUAL fechado pelo dono (2026-09-04, opção A):
--   * Seat extra em plano anual = seat_extra_cents * 12 (preço anual do seat),
--     prorateado por dias_restantes/365 até a renovação (fn_billing_prorate_cents).
--   * Renovação anual (kind=year) passa a somar extras anuais:
--     year_price + max(0, seats-included) * (seat_extra_cents*12).
--   * Upgrade dentro do anual: rateia o já pago (cobra só o DELTA anual entre os
--     planos) prorateado por dias_restantes/365 — "abate o outro, paga o resto".
--     Anual só sobe para anual porque o upgrade preserva billing_period da sub.
--
-- Toda a lógica de dinheiro/período vive no banco; o app só chama as RPCs de
-- quote e grava o amount que o banco calculou (nunca envia valor próprio).

-- ---------------------------------------------------------------------------
-- 1) rpc_create_billing_obligation — year branch com extras anuais (D9)
--    Redefinição completa preservando a lógica pending-aware (downgrade
--    agendado dropa extras). Única mudança vs 20260905131500: no ramo year,
--    soma (seats-included) * seat_extra_cents*12 quando há assentos extras.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_create_billing_obligation(
  p_company_id uuid,
  p_kind       text default 'subscription',
  p_seat_qty   integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.pagarme_subscriptions%rowtype;
  v_plan text;
  v_pending text;
  v_has_pending boolean;
  v_plan_row public.plans%rowtype;
  v_period text;
  v_kind text;
  v_seats int;
  v_included int;
  v_extras int;
  v_base int;
  v_list int;
  v_year int;
  v_amount_cents int;
  v_promo_left int;
  v_snap jsonb;
  v_existing public.invoices%rowtype;
  v_new public.invoices%rowtype;
begin
  v_kind := lower(coalesce(p_kind, 'subscription'));
  if v_kind = 'setup' then
    raise exception 'setup_abolished' using errcode = 'P0001';
  end if;
  if v_kind not in ('subscription', 'year') then
    raise exception 'unsupported_kind: %', v_kind using errcode = 'P0001';
  end if;

  select * into v_sub from public.pagarme_subscriptions where company_id = p_company_id limit 1;
  if not found then
    raise exception 'subscription_not_found for company %', p_company_id using errcode = 'P0001';
  end if;

  v_period := lower(coalesce(v_sub.billing_period, 'month'));
  if v_kind = 'year' then
    v_period := 'year';
  end if;

  -- effective plan = pending (downgrade agendado) senão plano atual
  v_pending := nullif(btrim(coalesce(v_sub.pending_plan_key, '')), '');
  v_has_pending := v_pending is not null;
  v_plan := lower(coalesce(v_pending, v_sub.plan::text, v_sub.plan_key, 'essencial'));
  v_plan := case v_plan
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else v_plan end;

  select * into v_plan_row from public.plans where key = v_plan limit 1;
  if not found then
    raise exception 'plan_not_found: %', v_plan using errcode = 'P0001';
  end if;

  v_included := greatest(1, coalesce(v_plan_row.included_seats, 1));

  -- com downgrade agendado, seats = included do destino (dropa extras)
  if v_has_pending then
    v_seats := v_included;
  else
    v_seats := coalesce(p_seat_qty, nullif(v_sub.seat_quantity, 0), v_included);
  end if;
  v_extras := greatest(0, v_seats - v_included);

  if v_period = 'year' then
    v_year := public.fn_billing_year_price_cents(
      v_plan_row.price_cents, v_plan_row.price_year_cents,
      v_plan_row.yearly_discount_mode, v_plan_row.yearly_discount_value);
    -- Opção A: extras anuais = (seats-included) * (seat_extra_cents * 12)
    if v_extras > 0 and coalesce(v_plan_row.seat_extra_cents, 0) > 0 then
      v_amount_cents := v_year + v_extras * (v_plan_row.seat_extra_cents * 12);
    else
      v_amount_cents := v_year;
    end if;
    v_kind := 'year';
  else
    v_base := v_plan_row.price_cents;
    v_list := public.fn_billing_monthly_charge_cents(
      v_base, v_included, v_seats, v_plan_row.seat_extra_cents);
    v_promo_left := coalesce(v_sub.promo_months_remaining, 0);
    v_snap := v_sub.promo_snapshot;
    if v_promo_left > 0 and v_snap is not null then
      v_amount_cents := public.fn_billing_apply_promo_cents(
        v_list, v_snap->>'adjustment_kind', v_snap->>'adjustment_mode',
        nullif(v_snap->>'adjustment_value', '')::integer);
    else
      v_amount_cents := v_list;
    end if;
    v_kind := 'subscription';
  end if;

  if v_amount_cents <= 0 then
    raise exception 'amount_invalid (% cents) plan % period %', v_amount_cents, v_plan, v_period using errcode = 'P0001';
  end if;

  select * into v_existing from public.invoices
  where company_id = p_company_id and kind = v_kind and status = 'pending' limit 1;
  if found then
    return jsonb_build_object('status','exists','invoice_id',v_existing.id,'company_id',p_company_id,
      'kind',v_kind,'amount_cents',round(v_existing.amount*100)::integer,'created',false);
  end if;

  begin
    insert into public.invoices (company_id, subscription_id, amount, status, kind, due_at,
      pagarme_order_id, pagarme_payment_url, pix_qr_code)
    values (p_company_id, v_sub.id, (v_amount_cents::numeric/100), 'pending', v_kind, now(), null, null, null)
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing from public.invoices
    where company_id = p_company_id and kind = v_kind and status = 'pending' limit 1;
    return jsonb_build_object('status','exists','invoice_id',v_existing.id,'company_id',p_company_id,
      'kind',v_kind,'amount_cents',round(v_existing.amount*100)::integer,'created',false);
  end;

  return jsonb_build_object('status','created','invoice_id',v_new.id,'company_id',p_company_id,
    'subscription_id',v_sub.id,'kind',v_kind,'period',v_period,'plan',v_plan,
    'seat_quantity',v_seats,'amount_cents',v_amount_cents,'created',true);
end;
$$;

revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from public;
revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from anon;
revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from authenticated;
grant execute on function public.rpc_create_billing_obligation(uuid, text, integer) to service_role;

comment on function public.rpc_create_billing_obligation(uuid, text, integer) is
  'ADR-0006 D9: invoice pending com amount canonico no banco. Anual soma extras (seat*12). App nao envia valor.';

-- ---------------------------------------------------------------------------
-- 2) rpc_quote_seat_add — proration de 1 seat, período-aware (D12 / opção A)
--    month: unit = seat_extra_cents,     cycle = 30
--    year:  unit = seat_extra_cents*12,  cycle = 365
--    days_left = ceil(next_billing_at - now); sem next → ciclo cheio.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_quote_seat_add(
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
  v_period text;
  v_unit int;
  v_cycle int;
  v_days int;
  v_amount int;
  v_included int;
  v_seats int;
begin
  select * into v_sub from public.pagarme_subscriptions where company_id = p_company_id limit 1;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;
  if v_sub.status::text not in ('active', 'trial', 'overdue') then
    raise exception 'subscription_not_eligible' using errcode = 'P0001';
  end if;

  v_plan := lower(coalesce(v_sub.plan::text, v_sub.plan_key, 'essencial'));
  v_plan := case v_plan
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else v_plan end;
  select * into v_plan_row from public.plans where key = v_plan limit 1;
  if not found then
    raise exception 'plan_not_found: %', v_plan using errcode = 'P0001';
  end if;
  if coalesce(v_plan_row.seat_extra_cents, 0) <= 0 then
    raise exception 'seat_not_available' using errcode = 'P0001';
  end if;

  v_period := lower(coalesce(v_sub.billing_period, 'month'));
  if v_period = 'year' then
    v_unit := v_plan_row.seat_extra_cents * 12;
    v_cycle := 365;
  else
    v_unit := v_plan_row.seat_extra_cents;
    v_cycle := 30;
  end if;

  if v_sub.next_billing_at is null then
    v_days := v_cycle;
  else
    v_days := greatest(0, ceil(extract(epoch from (v_sub.next_billing_at - now())) / 86400.0)::int);
  end if;

  v_amount := public.fn_billing_prorate_cents(v_unit, v_days, v_cycle);

  v_included := greatest(1, coalesce(v_plan_row.included_seats, 1));
  v_seats := greatest(v_included, coalesce(nullif(v_sub.seat_quantity, 0), v_included));

  return jsonb_build_object(
    'amount_cents', v_amount,
    'period', v_period,
    'unit_cents', v_unit,
    'cycle_days', v_cycle,
    'days_left', v_days,
    'seat_quantity_after', v_seats + 1,
    'next_billing_at', v_sub.next_billing_at,
    'plan', v_plan
  );
end;
$$;

revoke all on function public.rpc_quote_seat_add(uuid) from public;
revoke all on function public.rpc_quote_seat_add(uuid) from anon;
revoke all on function public.rpc_quote_seat_add(uuid) from authenticated;
grant execute on function public.rpc_quote_seat_add(uuid) to service_role;

comment on function public.rpc_quote_seat_add(uuid) is
  'ADR-0006 D12 / opcao A: proration de 1 seat periodo-aware (anual = seat*12 / 365). Amount canonico no banco.';

-- ---------------------------------------------------------------------------
-- 3) rpc_quote_plan_upgrade — DELTA prorateado, período-aware (BN-11 / opção A)
--    month: delta = to.price_cents - from.price_cents,     cycle = 30
--    year:  delta = year(to) - year(from),                 cycle = 365
--    Só active; só upgrade (rank destino > atual). Anual→anual implícito
--    (upgrade preserva billing_period). delta<=0 → applied_free.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_quote_plan_upgrade(
  p_company_id  uuid,
  p_target_plan text
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
  v_period text;
  v_rank_from int;
  v_rank_to int;
  v_from_amt int;
  v_to_amt int;
  v_delta int;
  v_cycle int;
  v_days int;
  v_amount int;
begin
  v_to := lower(btrim(coalesce(p_target_plan, '')));
  v_to := case v_to
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else v_to end;
  if v_to not in ('essencial', 'pro', 'market') then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  select * into v_sub from public.pagarme_subscriptions where company_id = p_company_id limit 1;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;
  if v_sub.status::text <> 'active' then
    raise exception 'subscription_not_eligible' using errcode = 'P0001';
  end if;

  v_from := lower(coalesce(v_sub.plan::text, v_sub.plan_key, 'essencial'));
  v_from := case v_from
    when 'bot' then 'essencial' when 'starter' then 'essencial' when 'complete' then 'pro'
    else v_from end;
  if v_from not in ('essencial', 'pro', 'market') then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  v_rank_from := case v_from when 'essencial' then 0 when 'pro' then 1 else 2 end;
  v_rank_to   := case v_to   when 'essencial' then 0 when 'pro' then 1 else 2 end;
  if v_rank_to <= v_rank_from then
    raise exception 'not_an_upgrade' using errcode = 'P0001';
  end if;

  select * into v_from_row from public.plans where key = v_from limit 1;
  select * into v_to_row   from public.plans where key = v_to   limit 1;
  if v_from_row.key is null or v_to_row.key is null then
    raise exception 'plan_not_found' using errcode = 'P0001';
  end if;

  v_period := lower(coalesce(v_sub.billing_period, 'month'));
  if v_period = 'year' then
    v_from_amt := public.fn_billing_year_price_cents(
      v_from_row.price_cents, v_from_row.price_year_cents,
      v_from_row.yearly_discount_mode, v_from_row.yearly_discount_value);
    v_to_amt := public.fn_billing_year_price_cents(
      v_to_row.price_cents, v_to_row.price_year_cents,
      v_to_row.yearly_discount_mode, v_to_row.yearly_discount_value);
    v_cycle := 365;
  else
    v_from_amt := v_from_row.price_cents;
    v_to_amt := v_to_row.price_cents;
    v_cycle := 30;
  end if;

  v_delta := v_to_amt - v_from_amt;
  if v_delta <= 0 then
    return jsonb_build_object(
      'amount_cents', 0, 'from_plan', v_from, 'to_plan', v_to,
      'period', v_period, 'applied_free', true,
      'next_billing_at', v_sub.next_billing_at);
  end if;

  if v_sub.next_billing_at is null then
    v_days := v_cycle;
  else
    v_days := greatest(0, ceil(extract(epoch from (v_sub.next_billing_at - now())) / 86400.0)::int);
  end if;

  v_amount := public.fn_billing_prorate_cents(v_delta, v_days, v_cycle);

  return jsonb_build_object(
    'amount_cents', v_amount, 'from_plan', v_from, 'to_plan', v_to,
    'period', v_period, 'delta_cents', v_delta, 'cycle_days', v_cycle,
    'days_left', v_days, 'applied_free', false,
    'next_billing_at', v_sub.next_billing_at);
end;
$$;

revoke all on function public.rpc_quote_plan_upgrade(uuid, text) from public;
revoke all on function public.rpc_quote_plan_upgrade(uuid, text) from anon;
revoke all on function public.rpc_quote_plan_upgrade(uuid, text) from authenticated;
grant execute on function public.rpc_quote_plan_upgrade(uuid, text) to service_role;

comment on function public.rpc_quote_plan_upgrade(uuid, text) is
  'ADR-0006 D12 / BN-11 opcao A: DELTA de upgrade prorateado periodo-aware (anual = delta anual / 365). Amount canonico no banco.';
