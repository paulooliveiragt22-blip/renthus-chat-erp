-- Crédito incluso da IA não acumula.
-- Reinicia quando vence o mês da assinatura (next_billing_at), não no dia 1 do calendário.
-- Plano anual: o incluso é mensal e vence no mesmo dia do ciclo, todo mês.
-- Pack prepaid comprado não entra nesse reset.

alter table public.company_ai_wallets
  add column if not exists included_period_end timestamptz;

comment on column public.company_ai_wallets.included_period_end is
  'Fim do mês de crédito incluso. O que sobrar zera neste instante; não soma no mês seguinte.';

create or replace function public.fn_ai_included_period_end(
  p_next timestamptz,
  p_period text,
  p_now timestamptz
)
returns timestamptz
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_next is null then
      ((date_trunc('month', p_now at time zone 'utc') + interval '1 month') at time zone 'utc')
    when lower(coalesce(p_period, 'month')) = 'year' then
      coalesce(
        (
          select min(gs)
            from generate_series(
              p_next - interval '11 months',
              p_next,
              interval '1 month'
            ) as gs
           where gs > p_now
             and gs <= p_next
        ),
        p_next
      )
    else
      coalesce(
        (
          select min(gs)
            from generate_series(
              p_next,
              p_next + interval '36 months',
              interval '1 month'
            ) as gs
           where gs > p_now
        ),
        p_next
      )
  end;
$$;

revoke all on function public.fn_ai_included_period_end(timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_ai_included_period_end(timestamptz, text, timestamptz) to service_role;

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
    'auto_recharge_last_error', v_row.auto_recharge_last_error
  );
end;
$$;
