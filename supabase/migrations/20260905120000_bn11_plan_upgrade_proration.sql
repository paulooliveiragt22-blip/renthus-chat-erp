-- BN-11: upgrade mid-cycle com proration (pay-to-unlock).

alter table public.invoices
  add column if not exists target_plan_key text null;

alter table public.invoices
  drop constraint if exists invoices_target_plan_key_check;
alter table public.invoices
  add constraint invoices_target_plan_key_check
  check (
    target_plan_key is null
    or target_plan_key in ('essencial', 'pro', 'market')
  );

comment on column public.invoices.target_plan_key is
  'Plano destino em kind=plan_upgrade (BN-11).';

alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices
  add constraint invoices_kind_check
  check (kind in ('setup', 'subscription', 'year', 'seat_add', 'ai_pack', 'plan_upgrade'));

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
    return jsonb_build_object(
      'status', 'not_found',
      'order_id', p_pagarme_order_id
    );
  end if;

  v_is_setup :=
    (v_inv.kind = 'setup')
    or (lower(coalesce(p_meta_type, '')) = 'setup');

  v_is_seat :=
    (v_inv.kind = 'seat_add')
    or (lower(coalesce(p_meta_type, '')) = 'seat_add');

  v_is_upgrade :=
    (v_inv.kind = 'plan_upgrade')
    or (lower(coalesce(p_meta_type, '')) = 'plan_upgrade');

  v_kind := case
    when v_is_setup then 'setup'
    when v_is_seat then 'seat_add'
    when v_is_upgrade then 'plan_upgrade'
    else 'invoice'
  end;

  if v_inv.status = 'paid' then
    return jsonb_build_object(
      'status', 'already_done',
      'kind', v_kind,
      'invoice_id', v_inv.id,
      'company_id', v_inv.company_id,
      'order_id', p_pagarme_order_id
    );
  end if;

  update public.invoices
  set
    status = 'paid',
    paid_at = v_paid_at
  where id = v_inv.id
    and status = 'pending'
  returning * into v_claimed;

  if not found then
    return jsonb_build_object(
      'status', 'already_done',
      'kind', v_kind,
      'invoice_id', v_inv.id,
      'company_id', v_inv.company_id,
      'order_id', p_pagarme_order_id
    );
  end if;

  select * into v_sub
  from public.pagarme_subscriptions
  where id = v_claimed.subscription_id
  limit 1;

  if not found then
    select * into v_sub
    from public.pagarme_subscriptions
    where company_id = v_claimed.company_id
    limit 1;
  end if;

  if not found then
    raise exception 'pagarme_subscription not found for company %', v_claimed.company_id
      using errcode = 'P0001';
  end if;

  v_cid := nullif(btrim(coalesce(p_pagarme_customer_id, '')), '');

  if v_is_seat then
    update public.pagarme_subscriptions
    set
      seat_quantity = greatest(1, coalesce(seat_quantity, 1)) + 1,
      pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
      updated_at = v_paid_at
    where id = v_sub.id
    returning seat_quantity into v_seats;

    update public.companies
    set is_active = true
    where id = v_claimed.company_id;

    return jsonb_build_object(
      'status', 'fulfilled',
      'kind', 'seat_add',
      'claimed', true,
      'invoice_id', v_claimed.id,
      'company_id', v_claimed.company_id,
      'subscription_id', v_sub.id,
      'order_id', p_pagarme_order_id,
      'seat_quantity', v_seats,
      'paid_at', v_paid_at
    );
  end if;

  if v_is_upgrade then
    v_plan := nullif(btrim(coalesce(v_claimed.target_plan_key, p_meta_plan, '')), '');
    if v_plan is null or btrim(v_plan) = '' then
      raise exception 'plan_upgrade missing target plan for order %', p_pagarme_order_id
        using errcode = 'P0001';
    end if;
    v_plan := case lower(v_plan)
      when 'bot' then 'essencial'
      when 'starter' then 'essencial'
      when 'complete' then 'pro'
      else lower(v_plan)
    end;

    select id, coalesce(included_seats, 1)
    into v_plan_id, v_included
    from public.plans
    where key = v_plan
    limit 1;

    if v_plan_id is null then
      raise exception 'plan % not found', v_plan using errcode = 'P0001';
    end if;

    update public.pagarme_subscriptions
    set
      plan = v_plan::public.subscription_plan,
      plan_key = v_plan,
      plan_id = v_plan_id,
      seat_quantity = greatest(coalesce(seat_quantity, 1), v_included),
      status = 'active'::public.pagarme_sub_status,
      pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
      pending_plan_key = null,
      pending_plan_change_at = null,
      pending_keep_user_ids = null,
      updated_at = v_paid_at
    where id = v_sub.id
    returning seat_quantity into v_seats;

    update public.companies
    set is_active = true
    where id = v_claimed.company_id;

    return jsonb_build_object(
      'status', 'fulfilled',
      'kind', 'plan_upgrade',
      'claimed', true,
      'invoice_id', v_claimed.id,
      'company_id', v_claimed.company_id,
      'subscription_id', v_sub.id,
      'plan', v_plan,
      'order_id', p_pagarme_order_id,
      'seat_quantity', v_seats,
      'paid_at', v_paid_at,
      'next_billing_at', v_sub.next_billing_at
    );
  end if;

  -- subscription renew / setup: apply pending downgrade first
  v_pending_apply := public.rpc_apply_pending_plan_change(v_sub.id);
  select * into v_sub
  from public.pagarme_subscriptions
  where id = v_sub.id;

  v_plan := nullif(btrim(coalesce(p_meta_plan, '')), '');
  if v_plan is null then
    v_plan := coalesce(v_sub.plan::text, v_sub.plan_key);
  end if;
  if (v_pending_apply->>'status') = 'applied' then
    v_plan := coalesce(v_sub.plan::text, v_sub.plan_key, v_plan);
  end if;
  if v_plan is null or btrim(v_plan) = '' then
    raise exception 'plan missing for order %', p_pagarme_order_id
      using errcode = 'P0001';
  end if;

  v_plan := case lower(v_plan)
    when 'bot' then 'essencial'
    when 'starter' then 'essencial'
    when 'complete' then 'pro'
    else lower(v_plan)
  end;

  v_next := (v_paid_at + interval '1 month');

  select id into v_plan_id
  from public.plans
  where key = v_plan
  limit 1;

  v_promo_left := null;
  if coalesce(v_sub.billing_period, 'month') = 'month'
     and coalesce(v_sub.promo_months_remaining, 0) > 0 then
    v_promo_left := greatest(0, v_sub.promo_months_remaining - 1);
  end if;

  update public.pagarme_subscriptions
  set
    plan = v_plan::public.subscription_plan,
    plan_key = v_plan,
    plan_id = coalesce(v_plan_id, plan_id),
    status = 'active'::public.pagarme_sub_status,
    last_paid_at = v_paid_at,
    next_billing_at = v_next,
    activated_at = coalesce(activated_at, v_paid_at),
    pagarme_customer_id = coalesce(v_cid, pagarme_customer_id),
    promo_months_remaining = case
      when v_promo_left is null then promo_months_remaining
      when v_promo_left = 0 then 0
      else v_promo_left
    end,
    promo_id = case
      when v_promo_left = 0 then null
      else promo_id
    end,
    updated_at = v_paid_at
  where id = v_sub.id;

  update public.companies
  set is_active = true
  where id = v_claimed.company_id;

  return jsonb_build_object(
    'status', 'fulfilled',
    'kind', v_kind,
    'claimed', true,
    'invoice_id', v_claimed.id,
    'company_id', v_claimed.company_id,
    'subscription_id', v_sub.id,
    'plan', v_plan,
    'order_id', p_pagarme_order_id,
    'next_billing_at', v_next,
    'paid_at', v_paid_at,
    'promo_months_remaining', v_promo_left,
    'pending_plan_apply', v_pending_apply
  );
end;
$$;

revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from public;
revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from anon;
revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from authenticated;
grant execute on function public.rpc_fulfill_obligation(text, text, text, text) to service_role;

comment on function public.rpc_fulfill_obligation(text, text, text, text) is
  'Claim invoice; seat_add; plan_upgrade (no next_billing bump); pending downgrade; renew + promo.';
