-- R3-6 / BN-06: crédito IA = 10% da lista mensal (plans.price_cents).
-- Coluna gerada + CHECK: superadmin altera preço → 10% acompanha; não se grava valor solto.

create or replace function public.fn_billing_ai_included_cents(p_list_month_cents integer)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select greatest(0, (coalesce(p_list_month_cents, 0) * 10) / 100);
$$;

revoke all on function public.fn_billing_ai_included_cents(integer) from public;
revoke all on function public.fn_billing_ai_included_cents(integer) from anon;
revoke all on function public.fn_billing_ai_included_cents(integer) from authenticated;
grant execute on function public.fn_billing_ai_included_cents(integer) to service_role;

comment on function public.fn_billing_ai_included_cents(integer) is
  'R3-6: 10% da lista mensal em centavos. Sem promo, sem anual.';

alter table public.plans drop constraint if exists plans_price_cents_positive;
alter table public.plans
  add constraint plans_price_cents_positive check (price_cents > 0);

alter table public.plans
  add column if not exists ai_included_cents integer
  generated always as (greatest(0, (price_cents * 10) / 100)) stored;

comment on column public.plans.ai_included_cents is
  'R3-6: 10% de price_cents (gerada).';

create or replace function public.rpc_ai_included_budget(p_company_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw text;
  v_key text;
  v_cents integer;
begin
  select ps.plan into v_raw
    from public.pagarme_subscriptions ps
   where ps.company_id = p_company_id
   limit 1;

  v_key := case lower(trim(coalesce(v_raw, 'essencial')))
    when 'bot' then 'essencial'
    when 'starter' then 'essencial'
    when 'complete' then 'pro'
    when 'essencial' then 'essencial'
    when 'pro' then 'pro'
    when 'market' then 'market'
    else 'essencial'
  end;

  select public.fn_billing_ai_included_cents(p.price_cents)
    into v_cents
    from public.plans p
   where p.key = v_key
   limit 1;

  if v_cents is null then
    select public.fn_billing_ai_included_cents(p.price_cents)
      into v_cents
      from public.plans p
     where p.key = 'essencial'
     limit 1;
  end if;

  return coalesce(v_cents, 0);
end;
$$;

revoke all on function public.rpc_ai_included_budget(uuid) from public;
revoke all on function public.rpc_ai_included_budget(uuid) from anon;
revoke all on function public.rpc_ai_included_budget(uuid) from authenticated;
grant execute on function public.rpc_ai_included_budget(uuid) to service_role;

comment on function public.rpc_ai_included_budget(uuid) is
  'Budget IA incluso do plano atual da company (10% lista mensal no banco).';

create or replace function public.rpc_list_commercial_plan_pricing()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', p.key,
        'price_cents', p.price_cents,
        'price_year_cents', p.price_year_cents,
        'ai_included_cents', public.fn_billing_ai_included_cents(p.price_cents),
        'yearly_discount_mode', p.yearly_discount_mode,
        'yearly_discount_value', p.yearly_discount_value
      )
      order by p.price_cents
    ),
    '[]'::jsonb
  )
  from public.plans p
  where p.key in ('essencial', 'pro', 'market');
$$;

revoke all on function public.rpc_list_commercial_plan_pricing() from public;
revoke all on function public.rpc_list_commercial_plan_pricing() from anon;
revoke all on function public.rpc_list_commercial_plan_pricing() from authenticated;
grant execute on function public.rpc_list_commercial_plan_pricing() to service_role;

comment on function public.rpc_list_commercial_plan_pricing() is
  'Lista mensal/anual/IA incluso dos planos comerciais — só plans, sem catálogo TS.';

create or replace function public.tg_plans_sync_ai_wallet_budget()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.price_cents is not distinct from old.price_cents then
    return new;
  end if;
  update public.company_ai_wallets w
     set included_budget_cents = public.fn_billing_ai_included_cents(new.price_cents),
         updated_at = now()
   where exists (
     select 1
       from public.pagarme_subscriptions ps
      where ps.company_id = w.company_id
        and ps.plan = new.key
   );
  return new;
end;
$$;

revoke all on function public.tg_plans_sync_ai_wallet_budget() from public;
revoke all on function public.tg_plans_sync_ai_wallet_budget() from anon;
revoke all on function public.tg_plans_sync_ai_wallet_budget() from authenticated;

drop trigger if exists trg_plans_sync_ai_wallet_budget on public.plans;
create trigger trg_plans_sync_ai_wallet_budget
  after insert or update of price_cents on public.plans
  for each row
  execute function public.tg_plans_sync_ai_wallet_budget();
