-- Aviso de crédito baixo e piso da recarga automática: 10% do crédito incluso do plano
-- (included_budget_cents / 10). Não é 10% do preço cheio do plano.
-- O aviso é reivindicado uma vez por included_period_end e só com recarga automática desligada.

alter table public.company_ai_wallets
  add column if not exists low_credit_notice_period_end timestamptz;

comment on column public.company_ai_wallets.low_credit_notice_period_end is
  'included_period_end do ciclo em que o aviso de 10% já foi enviado. Não preenche enquanto auto_recharge_enabled.';

create or replace function public.fn_ai_low_credit_threshold_cents(p_included_budget_cents integer)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when coalesce(p_included_budget_cents, 0) <= 0 then 0
    else p_included_budget_cents / 10
  end;
$$;

revoke all on function public.fn_ai_low_credit_threshold_cents(integer) from public, anon, authenticated;
grant execute on function public.fn_ai_low_credit_threshold_cents(integer) to service_role;

create or replace function public.rpc_ensure_ai_wallet(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_budget integer := public.rpc_ai_included_budget(p_company_id);
  v_row public.company_ai_wallets%rowtype;
  v_next timestamptz;
  v_billing_period text;
  v_status text;
  v_period_end timestamptz;
  v_included_left integer;
  v_remaining integer;
  v_discarded integer;
begin
  insert into public.company_ai_wallets (
    company_id, period_ym, included_budget_cents, included_spent_cents, prepaid_balance_cents
  ) values (
    p_company_id, to_char((now() at time zone 'utc'), 'YYYY-MM'), v_budget, 0, 0
  )
  on conflict (company_id) do nothing;

  select * into v_row
    from public.company_ai_wallets
   where company_id = p_company_id
   for update;

  select ps.next_billing_at, ps.billing_period, ps.status::text
    into v_next, v_billing_period, v_status
    from public.pagarme_subscriptions ps
   where ps.company_id = p_company_id
   order by case when ps.status::text in ('active', 'trial') then 0 else 1 end,
            ps.next_billing_at desc nulls last
   limit 1;

  if v_status is null or v_status in ('active', 'trial') then
    v_period_end := public.fn_ai_included_period_end(v_next, v_billing_period, now());
  else
    v_period_end := coalesce(v_next, public.fn_ai_included_period_end(null, 'month', now()));
  end if;

  if v_row.included_period_end is null and v_row.reserved_cents = 0 then
    update public.company_ai_wallets
       set included_period_end = v_period_end,
           included_budget_cents = v_budget,
           period_ym = to_char((v_period_end at time zone 'utc'), 'YYYY-MM-DD'),
           updated_at = now()
     where company_id = p_company_id
     returning * into v_row;
  elsif v_row.reserved_cents = 0
        and v_row.included_period_end is not null
        and now() >= v_row.included_period_end
        and v_period_end > v_row.included_period_end then
    v_discarded := greatest(0, v_row.included_budget_cents - v_row.included_spent_cents);
    update public.company_ai_wallets
       set included_period_end = v_period_end,
           included_budget_cents = v_budget,
           included_spent_cents = 0,
           period_ym = to_char((v_period_end at time zone 'utc'), 'YYYY-MM-DD'),
           updated_at = now()
     where company_id = p_company_id
     returning * into v_row;
    insert into public.company_ai_ledger (company_id, kind, amount_cents, meta)
    values (
      p_company_id,
      'period_reset',
      v_budget,
      jsonb_build_object(
        'included_period_end', v_period_end,
        'discarded_included_cents', v_discarded,
        'cumulative', false
      )
    );
  elsif v_row.reserved_cents = 0
        and v_row.included_period_end is not null
        and now() >= v_row.included_period_end
        and v_row.included_spent_cents < v_row.included_budget_cents then
    v_discarded := v_row.included_budget_cents - v_row.included_spent_cents;
    update public.company_ai_wallets
       set included_spent_cents = included_budget_cents,
           updated_at = now()
     where company_id = p_company_id
     returning * into v_row;
    insert into public.company_ai_ledger (company_id, kind, amount_cents, meta)
    values (
      p_company_id,
      'period_reset',
      0,
      jsonb_build_object(
        'included_period_end', v_row.included_period_end,
        'discarded_included_cents', v_discarded,
        'expired_without_renewal', true
      )
    );
  elsif v_row.included_budget_cents is distinct from v_budget and v_row.reserved_cents = 0 then
    update public.company_ai_wallets
       set included_budget_cents = v_budget,
           updated_at = now()
     where company_id = p_company_id
     returning * into v_row;
  end if;

  v_included_left := greatest(0, v_row.included_budget_cents - v_row.included_spent_cents);
  v_remaining := greatest(0, v_included_left + v_row.prepaid_balance_cents - v_row.reserved_cents);

  return jsonb_build_object(
    'period_ym', v_row.period_ym,
    'included_period_end', v_row.included_period_end,
    'included_budget_cents', v_row.included_budget_cents,
    'included_spent_cents', v_row.included_spent_cents,
    'prepaid_balance_cents', v_row.prepaid_balance_cents,
    'remaining_included_cents', v_included_left,
    'remaining_total_cents', v_remaining,
    'reserved_cents', v_row.reserved_cents,
    'last_debit_cents', v_row.last_debit_cents,
    'auto_recharge_enabled', v_row.auto_recharge_enabled,
    'auto_recharge_pack_cents', v_row.auto_recharge_pack_cents,
    'auto_recharge_last_error', v_row.auto_recharge_last_error,
    'low_balance_threshold_cents', public.fn_ai_low_credit_threshold_cents(v_row.included_budget_cents)
  );
end;
$$;

create or replace function public.rpc_note_ai_low_credit(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snap jsonb;
  v_threshold integer;
  v_remaining integer;
  v_auto boolean;
  v_pack integer;
  v_period_end timestamptz;
  v_notify boolean := false;
begin
  if p_company_id is null then
    return jsonb_build_object(
      'notify_low', false,
      'recharge_needed', false,
      'low_balance_threshold_cents', 0,
      'remaining_total_cents', 0
    );
  end if;

  v_snap := public.rpc_ensure_ai_wallet(p_company_id);
  v_threshold := coalesce((v_snap->>'low_balance_threshold_cents')::integer, 0);
  v_remaining := coalesce((v_snap->>'remaining_total_cents')::integer, 0);
  v_auto := coalesce((v_snap->>'auto_recharge_enabled')::boolean, false);
  v_pack := nullif(v_snap->>'auto_recharge_pack_cents', '')::integer;
  v_period_end := nullif(v_snap->>'included_period_end', '')::timestamptz;

  if v_auto is not true
     and v_threshold > 0
     and v_remaining <= v_threshold
     and v_period_end is not null then
    update public.company_ai_wallets
       set low_credit_notice_period_end = v_period_end,
           updated_at = now()
     where company_id = p_company_id
       and auto_recharge_enabled = false
       and included_period_end is not distinct from v_period_end
       and low_credit_notice_period_end is distinct from v_period_end;
    v_notify := found;
  end if;

  return jsonb_build_object(
    'notify_low', v_notify,
    'recharge_needed', (
      v_auto
      and v_pack in (1000, 2000, 5000)
      and v_threshold > 0
      and v_remaining <= v_threshold
    ),
    'low_balance_threshold_cents', v_threshold,
    'remaining_total_cents', v_remaining
  );
end;
$$;

revoke all on function public.rpc_note_ai_low_credit(uuid) from public, anon, authenticated;
grant execute on function public.rpc_note_ai_low_credit(uuid) to service_role;
