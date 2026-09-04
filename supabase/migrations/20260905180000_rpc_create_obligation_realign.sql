-- rpc_create_billing_obligation: se já existe pending do kind, realinha amount
-- canônico (plano/seats/promo/período) e limpa PIX/order stale.
-- App deixa de UPDATE amount / INSERT invoice no checkout e no rebill.

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
  v_brl numeric;
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

  v_brl := (v_amount_cents::numeric / 100);

  select * into v_existing from public.invoices
  where company_id = p_company_id and kind = v_kind and status = 'pending' limit 1;
  if found then
    if abs(coalesce(v_existing.amount, 0) - v_brl) > 0.02 then
      update public.invoices
      set amount = v_brl,
          pagarme_order_id = null,
          pagarme_payment_url = null,
          pix_qr_code = null
      where id = v_existing.id
        and status = 'pending';
      return jsonb_build_object(
        'status', 'realigned',
        'invoice_id', v_existing.id,
        'company_id', p_company_id,
        'kind', v_kind,
        'period', v_period,
        'plan', v_plan,
        'amount_cents', v_amount_cents,
        'created', false,
        'realigned', true
      );
    end if;
    return jsonb_build_object(
      'status', 'exists',
      'invoice_id', v_existing.id,
      'company_id', p_company_id,
      'kind', v_kind,
      'period', v_period,
      'plan', v_plan,
      'amount_cents', v_amount_cents,
      'created', false,
      'realigned', false
    );
  end if;

  begin
    insert into public.invoices (company_id, subscription_id, amount, status, kind, due_at,
      pagarme_order_id, pagarme_payment_url, pix_qr_code)
    values (p_company_id, v_sub.id, v_brl, 'pending', v_kind, now(), null, null, null)
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing from public.invoices
    where company_id = p_company_id and kind = v_kind and status = 'pending' limit 1;
    if found and abs(coalesce(v_existing.amount, 0) - v_brl) > 0.02 then
      update public.invoices
      set amount = v_brl,
          pagarme_order_id = null,
          pagarme_payment_url = null,
          pix_qr_code = null
      where id = v_existing.id
        and status = 'pending';
      return jsonb_build_object(
        'status', 'realigned',
        'invoice_id', v_existing.id,
        'company_id', p_company_id,
        'kind', v_kind,
        'amount_cents', v_amount_cents,
        'created', false,
        'realigned', true
      );
    end if;
    return jsonb_build_object(
      'status', 'exists',
      'invoice_id', v_existing.id,
      'company_id', p_company_id,
      'kind', v_kind,
      'amount_cents', v_amount_cents,
      'created', false,
      'realigned', false
    );
  end;

  return jsonb_build_object(
    'status', 'created',
    'invoice_id', v_new.id,
    'company_id', p_company_id,
    'subscription_id', v_sub.id,
    'kind', v_kind,
    'period', v_period,
    'plan', v_plan,
    'seat_quantity', v_seats,
    'amount_cents', v_amount_cents,
    'created', true,
    'realigned', false
  );
end;
$$;

revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from public;
revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from anon;
revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from authenticated;
grant execute on function public.rpc_create_billing_obligation(uuid, text, integer) to service_role;

comment on function public.rpc_create_billing_obligation(uuid, text, integer) is
  'ADR-0006 D9: cria ou realinha invoice pending com amount canônico no banco. App não envia valor.';
