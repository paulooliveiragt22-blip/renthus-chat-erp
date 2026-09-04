-- BN-12 / R3-4: downgrade agendado + keep-users + apply no fulfill.

alter table public.pagarme_subscriptions
  add column if not exists pending_plan_key text null,
  add column if not exists pending_plan_change_at timestamptz null,
  add column if not exists pending_keep_user_ids uuid[] null;

alter table public.pagarme_subscriptions
  drop constraint if exists pagarme_subscriptions_pending_plan_key_check;
alter table public.pagarme_subscriptions
  add constraint pagarme_subscriptions_pending_plan_key_check
  check (
    pending_plan_key is null
    or pending_plan_key in ('essencial', 'pro', 'market')
  );

comment on column public.pagarme_subscriptions.pending_plan_key is
  'Plano destino agendado (downgrade). Null = sem agendamento. BN-12.';
comment on column public.pagarme_subscriptions.pending_plan_change_at is
  'Data efetiva (= next_billing_at no agendamento).';
comment on column public.pagarme_subscriptions.pending_keep_user_ids is
  'Users a manter no plano destino; demais soft-deactivate na aplicação. R3-4.';

-- Aplica pending na subscription: plano, seats, desativa users, limpa pending_*.
create or replace function public.rpc_apply_pending_plan_change(
  p_subscription_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.pagarme_subscriptions%rowtype;
  v_plan text;
  v_plan_id uuid;
  v_included int;
  v_deactivated int := 0;
begin
  if p_subscription_id is null then
    raise exception 'subscription_id required' using errcode = 'P0001';
  end if;

  select * into v_sub
  from public.pagarme_subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_sub.pending_plan_key is null then
    return jsonb_build_object('status', 'noop', 'subscription_id', v_sub.id);
  end if;

  v_plan := lower(btrim(v_sub.pending_plan_key));

  select id, coalesce(included_seats, 1)
  into v_plan_id, v_included
  from public.plans
  where key = v_plan
  limit 1;

  if v_plan_id is null then
    raise exception 'pending plan % not found', v_plan using errcode = 'P0001';
  end if;

  if v_sub.pending_keep_user_ids is not null then
    update public.company_users
    set is_active = false
    where company_id = v_sub.company_id
      and coalesce(is_active, true) = true
      and not (user_id = any (v_sub.pending_keep_user_ids));
    get diagnostics v_deactivated = row_count;
  end if;

  update public.pagarme_subscriptions
  set
    plan = v_plan::public.subscription_plan,
    plan_key = v_plan,
    plan_id = v_plan_id,
    seat_quantity = greatest(1, v_included),
    pending_plan_key = null,
    pending_plan_change_at = null,
    pending_keep_user_ids = null,
    updated_at = now()
  where id = v_sub.id;

  return jsonb_build_object(
    'status', 'applied',
    'subscription_id', v_sub.id,
    'company_id', v_sub.company_id,
    'plan', v_plan,
    'seat_quantity', greatest(1, v_included),
    'deactivated_users', v_deactivated
  );
end;
$$;

revoke all on function public.rpc_apply_pending_plan_change(uuid) from public;
revoke all on function public.rpc_apply_pending_plan_change(uuid) from anon;
revoke all on function public.rpc_apply_pending_plan_change(uuid) from authenticated;
grant execute on function public.rpc_apply_pending_plan_change(uuid) to service_role;

comment on function public.rpc_apply_pending_plan_change(uuid) is
  'Aplica pending_plan_* (downgrade): troca plano, cap seats, soft-deactivate users fora do keep.';

-- Fulfill: aplica pending antes de renovar (subscription / setup; não seat_add).
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
  v_plan text;
  v_plan_id uuid;
  v_kind text;
  v_cid text;
  v_seats int;
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

  v_kind := case
    when v_is_setup then 'setup'
    when v_is_seat then 'seat_add'
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

  -- Downgrade agendado: aplica antes de renovar.
  v_pending_apply := public.rpc_apply_pending_plan_change(v_sub.id);
  select * into v_sub
  from public.pagarme_subscriptions
  where id = v_sub.id;

  v_plan := nullif(btrim(coalesce(p_meta_plan, '')), '');
  if v_plan is null then
    v_plan := coalesce(v_sub.plan::text, v_sub.plan_key);
  end if;
  -- Se acabamos de aplicar pending, o plano da sub é a fonte de verdade.
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
  'Claim invoice; seat_add; apply pending downgrade; renew + promo decrement.';
