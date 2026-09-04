-- Endurecimento total — Pacote 2 (ADR-0006 D9/D10 / rule governanca Regra 2):
--  * fn_billing_year_price_cents: preço anual canônico (year cols / desconto).
--  * rpc_create_billing_obligation: cria invoice pending com amount CALCULADO
--    no banco (app nunca envia valor). Fecha F2.
--  * rpc_fulfill_obligation: next_billing_at period-aware via fn_billing_next_due
--    (mata +1 mês fixo). Fecha F4.
--  * BN-05/F3: cancela invoices setup pending órfãs (setup abolido).

-- ---------------------------------------------------------------------------
-- 1) Preço anual canônico (R2-2 / BN-04). Espelha yearlyFromDiscount:
--    usa price_year_cents se > 0; senão price_cents*12 menos desconto.
-- ---------------------------------------------------------------------------
create or replace function public.fn_billing_year_price_cents(
  p_price_cents          integer,
  p_price_year_cents     integer,
  p_yearly_discount_mode text,
  p_yearly_discount_value integer
)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with n as (
    select
      greatest(0, coalesce(p_price_cents, 0))          as base,
      p_price_year_cents                                as year_col,
      greatest(0, coalesce(p_yearly_discount_value, 0)) as disc
  ),
  computed as (
    select base, year_col,
      case
        when lower(coalesce(p_yearly_discount_mode, 'percent')) = 'percent'
          then greatest(0, (base * 12) - round((base * 12)::numeric * disc / 10000)::integer)
        else greatest(0, (base * 12) - disc)
      end as from_discount
    from n
  )
  select case
    when year_col is not null and year_col > 0 then year_col
    else from_discount
  end
  from computed;
$$;

-- ---------------------------------------------------------------------------
-- 2) rpc_create_billing_obligation — amount canônico no banco (D9)
--    kind ∈ {subscription, year}. seat_add / plan_upgrade têm proration própria
--    (checkout dedicado) — fora daqui. Idempotente via
--    uq_invoices_one_pending_per_company_kind.
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
    raise exception 'setup_abolished' using errcode = 'P0001';  -- BN-05
  end if;
  if v_kind not in ('subscription', 'year') then
    raise exception 'unsupported_kind: %', v_kind using errcode = 'P0001';
  end if;

  select * into v_sub
  from public.pagarme_subscriptions
  where company_id = p_company_id
  limit 1;
  if not found then
    raise exception 'subscription_not_found for company %', p_company_id using errcode = 'P0001';
  end if;

  v_period := lower(coalesce(v_sub.billing_period, 'month'));
  -- kind=year força período anual; kind=subscription segue o período da sub
  if v_kind = 'year' then
    v_period := 'year';
  end if;

  v_plan := lower(coalesce(v_sub.plan::text, v_sub.plan_key, 'essencial'));
  v_plan := case v_plan
    when 'bot' then 'essencial'
    when 'starter' then 'essencial'
    when 'complete' then 'pro'
    else v_plan
  end;

  select * into v_plan_row from public.plans where key = v_plan limit 1;
  if not found then
    raise exception 'plan_not_found: %', v_plan using errcode = 'P0001';
  end if;

  v_seats := coalesce(
    p_seat_qty,
    nullif(v_sub.seat_quantity, 0),
    coalesce(v_plan_row.included_seats, 1)
  );

  if v_period = 'year' then
    -- Anual: valor anual canônico; sem promo (R3-2); sem seat mid-cycle aqui.
    v_amount_cents := public.fn_billing_year_price_cents(
      v_plan_row.price_cents,
      v_plan_row.price_year_cents,
      v_plan_row.yearly_discount_mode,
      v_plan_row.yearly_discount_value
    );
    v_kind := 'year';
  else
    v_base := v_plan_row.price_cents;
    v_list := public.fn_billing_monthly_charge_cents(
      v_base,
      coalesce(v_plan_row.included_seats, 1),
      v_seats,
      v_plan_row.seat_extra_cents
    );
    -- Promo só mensal e só com meses restantes (R3-1)
    v_promo_left := coalesce(v_sub.promo_months_remaining, 0);
    v_snap := v_sub.promo_snapshot;
    if v_promo_left > 0 and v_snap is not null then
      v_amount_cents := public.fn_billing_apply_promo_cents(
        v_list,
        v_snap->>'adjustment_kind',
        v_snap->>'adjustment_mode',
        nullif(v_snap->>'adjustment_value', '')::integer
      );
    else
      v_amount_cents := v_list;
    end if;
    v_kind := 'subscription';
  end if;

  if v_amount_cents <= 0 then
    raise exception 'amount_invalid (% cents) plan % period %', v_amount_cents, v_plan, v_period
      using errcode = 'P0001';
  end if;

  -- Idempotência: já existe pending deste kind?
  select * into v_existing
  from public.invoices
  where company_id = p_company_id
    and kind = v_kind
    and status = 'pending'
  limit 1;
  if found then
    return jsonb_build_object(
      'status', 'exists',
      'invoice_id', v_existing.id,
      'company_id', p_company_id,
      'kind', v_kind,
      'amount_cents', round(v_existing.amount * 100)::integer,
      'created', false
    );
  end if;

  begin
    insert into public.invoices (
      company_id, subscription_id, amount, status, kind, due_at,
      pagarme_order_id, pagarme_payment_url, pix_qr_code
    ) values (
      p_company_id, v_sub.id, (v_amount_cents::numeric / 100), 'pending', v_kind, now(),
      null, null, null
    )
    returning * into v_new;
  exception when unique_violation then
    select * into v_existing
    from public.invoices
    where company_id = p_company_id and kind = v_kind and status = 'pending'
    limit 1;
    return jsonb_build_object(
      'status', 'exists',
      'invoice_id', v_existing.id,
      'company_id', p_company_id,
      'kind', v_kind,
      'amount_cents', round(v_existing.amount * 100)::integer,
      'created', false
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
    'created', true
  );
end;
$$;

revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from public;
revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from anon;
revoke all on function public.rpc_create_billing_obligation(uuid, text, integer) from authenticated;
grant execute on function public.rpc_create_billing_obligation(uuid, text, integer) to service_role;

comment on function public.rpc_create_billing_obligation(uuid, text, integer) is
  'ADR-0006 D9: cria invoice pending com amount CALCULADO no banco (plano+seats+promo+período). App não envia valor.';

-- ---------------------------------------------------------------------------
-- 3) BN-05 / F3: cancelar invoices setup pending órfãs (setup abolido)
-- ---------------------------------------------------------------------------
update public.invoices
set status = 'cancelled'
where kind = 'setup' and status = 'pending';

-- ---------------------------------------------------------------------------
-- 4) rpc_fulfill_obligation: next_billing_at period-aware (F4/D10)
--    Recriação completa; única mudança funcional vs 20260905120000:
--    v_next usa fn_billing_next_due(paid_at, billing_period).
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

  v_kind := case
    when v_is_setup then 'setup'
    when v_is_seat then 'seat_add'
    when v_is_upgrade then 'plan_upgrade'
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
  'Claim invoice; seat_add; plan_upgrade; pending downgrade; renew + promo. next_billing period-aware (fn_billing_next_due).';
