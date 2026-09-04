-- Endurecimento total — Pacote 2b (ADR-0006 D9):
-- rpc_create_billing_obligation passa a considerar pending_plan_key (downgrade
-- agendado) ao calcular o amount da renovação — espelha effectiveChargePlanKey:
-- se há downgrade agendado, cobra o plano DESTINO (e included_seats do destino).
-- Sem isso, empresa com downgrade agendado seria cobrada pelo plano atual (maior).

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
  v_base int;
  v_list int;
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

  -- com downgrade agendado, seats = included do destino (dropa extras)
  if v_has_pending then
    v_seats := greatest(1, coalesce(v_plan_row.included_seats, 1));
  else
    v_seats := coalesce(p_seat_qty, nullif(v_sub.seat_quantity, 0), coalesce(v_plan_row.included_seats, 1));
  end if;

  if v_period = 'year' then
    v_amount_cents := public.fn_billing_year_price_cents(
      v_plan_row.price_cents, v_plan_row.price_year_cents,
      v_plan_row.yearly_discount_mode, v_plan_row.yearly_discount_value);
    v_kind := 'year';
  else
    v_base := v_plan_row.price_cents;
    v_list := public.fn_billing_monthly_charge_cents(
      v_base, coalesce(v_plan_row.included_seats, 1), v_seats, v_plan_row.seat_extra_cents);
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
  'ADR-0006 D9: cria invoice pending com amount canonico no banco (plano/pending+seats+promo+periodo). App nao envia valor.';
