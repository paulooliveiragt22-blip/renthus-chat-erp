-- C2: rpc_fulfill_obligation — branch kind=seat_add (bump seat_quantity, sem mexer next_billing_at).

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

  -- R3-3: seat_add — só aumenta capacidade; não reancora ciclo.
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

  v_plan := nullif(btrim(coalesce(p_meta_plan, '')), '');
  if v_plan is null then
    v_plan := coalesce(v_sub.plan::text, v_sub.plan_key);
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
    'paid_at', v_paid_at
  );
end;
$$;

revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from public;
revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from anon;
revoke all on function public.rpc_fulfill_obligation(text, text, text, text) from authenticated;
grant execute on function public.rpc_fulfill_obligation(text, text, text, text) to service_role;

comment on function public.rpc_fulfill_obligation(text, text, text, text) is
  'Claim invoice + activate sub; kind=seat_add só incrementa seat_quantity (R3-3).';
