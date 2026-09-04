-- P0: invoices.kind aceita period_switch + obrigação/aplicação free só via RPC.
-- App não INSERT invoice nem calcula next_billing_at (governança Regra 2).

alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices
  add constraint invoices_kind_check
  check (kind in (
    'setup',
    'subscription',
    'year',
    'seat_add',
    'ai_pack',
    'plan_upgrade',
    'period_switch'
  ));

create or replace function public.rpc_ensure_period_switch_obligation(
  p_company_id uuid
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
  v_applied_free boolean;
  v_existing public.invoices%rowtype;
  v_new public.invoices%rowtype;
  v_brl numeric;
  v_next timestamptz;
begin
  v_quote := public.rpc_quote_period_switch(p_company_id);
  v_amount_cents := greatest(0, coalesce((v_quote->>'amount_cents')::int, 0));
  v_annual_cents := greatest(0, coalesce((v_quote->>'annual_cents')::int, 0));
  v_credit_cents := greatest(0, coalesce((v_quote->>'credit_cents')::int, 0));
  v_plan := coalesce(v_quote->>'plan', 'essencial');
  v_applied_free := coalesce((v_quote->>'applied_free')::boolean, false) or v_amount_cents <= 0;

  select * into v_sub
  from public.pagarme_subscriptions
  where company_id = p_company_id
  limit 1;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;

  if v_applied_free then
    v_next := public.fn_billing_next_due(now(), 'year');
    update public.pagarme_subscriptions
    set billing_period = 'year',
        next_billing_at = v_next,
        last_paid_at = now(),
        updated_at = now()
    where id = v_sub.id;
    return jsonb_build_object(
      'status', 'applied_free',
      'applied_free', true,
      'plan', v_plan,
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
    if abs(coalesce(v_existing.amount, 0) - v_brl) > 0.02 then
      update public.invoices
      set amount = v_brl,
          pagarme_order_id = null,
          pagarme_payment_url = null,
          pix_qr_code = null
      where id = v_existing.id
        and status = 'pending';
      v_existing.amount := v_brl;
      v_existing.pagarme_order_id := null;
    end if;
    return jsonb_build_object(
      'status', 'exists',
      'applied_free', false,
      'invoice_id', v_existing.id,
      'company_id', p_company_id,
      'kind', 'period_switch',
      'plan', v_plan,
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
      pagarme_order_id, pagarme_payment_url, pix_qr_code
    ) values (
      p_company_id, v_sub.id, v_brl, 'pending', 'period_switch', now(),
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
    'amount_cents', v_amount_cents,
    'annual_cents', v_annual_cents,
    'credit_cents', v_credit_cents,
    'pagarme_order_id', null,
    'created', true
  );
end;
$$;

revoke all on function public.rpc_ensure_period_switch_obligation(uuid) from public;
revoke all on function public.rpc_ensure_period_switch_obligation(uuid) from anon;
revoke all on function public.rpc_ensure_period_switch_obligation(uuid) from authenticated;
grant execute on function public.rpc_ensure_period_switch_obligation(uuid) to service_role;

comment on function public.rpc_ensure_period_switch_obligation(uuid) is
  'Cria/reusa invoice period_switch com amount da quote; applied_free aplica year + next via fn_billing_next_due.';
