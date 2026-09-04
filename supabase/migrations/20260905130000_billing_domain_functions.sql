-- Endurecimento total (ADR-0006 emenda D9–D12 / rule governanca §Regra 2):
-- regra de negócio de billing amarrada no banco como funções puras IMMUTABLE.
-- Fonte única: TS deixa de recalcular dinheiro/tempo/dunning.
--
-- Pacote 1: domínio + aritmética (sem I/O). Migrations seguintes:
--   2) rpc_create_billing_obligation (amount canônico) + fulfill period-aware
--   3) rpc_schedule_downgrade + trigger seat cap
--
-- Segurança (supabase-migrations-seguranca.mdc): funções puras, sem acesso a
-- tabela; search_path fixo; execute revogado de public, concedido a service_role
-- e authenticated (leitura para UX via RPC; nunca reimplementar em TS).

-- ---------------------------------------------------------------------------
-- 1) Domínio billing_period ∈ {month, year} (D10 / R2-3)
-- ---------------------------------------------------------------------------
alter table public.pagarme_subscriptions
  alter column billing_period set default 'month';

update public.pagarme_subscriptions
  set billing_period = 'month'
  where billing_period is null or btrim(billing_period) = '';

alter table public.pagarme_subscriptions
  alter column billing_period set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pagarme_subscriptions'::regclass
      and conname = 'pagarme_subscriptions_billing_period_check'
  ) then
    alter table public.pagarme_subscriptions
      add constraint pagarme_subscriptions_billing_period_check
      check (billing_period in ('month', 'year'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) fn_billing_next_due(paid_at, period) — próximo vencimento (D10)
--    +1 month | +1 year. Substitui computeNextBillingAt (+1m fixo) e o
--    interval '1 month' hardcoded em rpc_fulfill_obligation.
-- ---------------------------------------------------------------------------
create or replace function public.fn_billing_next_due(
  p_paid_at timestamptz,
  p_period  text
)
returns timestamptz
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when lower(coalesce(p_period, 'month')) = 'year'
      then p_paid_at + interval '1 year'
    else p_paid_at + interval '1 month'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3) fn_billing_prorate_cents(unit, days_left, cycle_days) — proration (D12)
--    Seat mid-cycle (R3-3) e upgrade (BN-11). Sem cap artificial de 30 dias:
--    cycle_days é o ciclo real (30 mensal, 365 anual).
-- ---------------------------------------------------------------------------
create or replace function public.fn_billing_prorate_cents(
  p_unit_cents integer,
  p_days_left  integer,
  p_cycle_days integer
)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when coalesce(p_unit_cents, 0) <= 0 then 0
    when coalesce(p_days_left, 0) <= 0 then p_unit_cents
    else greatest(
      1,
      round(
        p_unit_cents::numeric
        * least(p_days_left, greatest(1, p_cycle_days))
        / greatest(1, p_cycle_days)
      )::integer
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4) fn_billing_monthly_charge_cents — lista + seats (D9)
--    Espelha computeMonthlyChargeCents: base + max(0, seats-included)*extra.
-- ---------------------------------------------------------------------------
create or replace function public.fn_billing_monthly_charge_cents(
  p_base_cents       integer,
  p_included_seats   integer,
  p_seat_quantity    integer,
  p_seat_extra_cents integer
)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with n as (
    select
      greatest(0, coalesce(p_base_cents, 0))                as base,
      greatest(1, coalesce(p_included_seats, 1))            as included,
      greatest(1, coalesce(p_seat_quantity, 1))             as seats,
      p_seat_extra_cents                                    as extra
  )
  select case
    when (seats - included) <= 0 then base
    when extra is null or extra <= 0 then base   -- cap sem seat à venda
    else base + (seats - included) * floor(extra)::integer
  end
  from n;
$$;

-- ---------------------------------------------------------------------------
-- 5) fn_billing_apply_promo_cents — desconto/acréscimo promo (D9 / R2-1)
--    Espelha applyPromoAdjustmentCents. mode: 'fixed_brl' (centavos) |
--    'percent' (basis points: 5000 = 50%). kind: 'discount' | 'surcharge'.
-- ---------------------------------------------------------------------------
create or replace function public.fn_billing_apply_promo_cents(
  p_list_cents       integer,
  p_adjustment_kind  text,
  p_adjustment_mode  text,
  p_adjustment_value integer
)
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with n as (
    select
      greatest(0, coalesce(p_list_cents, 0))     as base,
      greatest(0, coalesce(p_adjustment_value, 0)) as val
  ),
  d as (
    select base,
      case
        when lower(coalesce(p_adjustment_mode, 'fixed_brl')) = 'fixed_brl' then val
        else round(base::numeric * val / 10000)::integer
      end as delta
    from n
  )
  select case
    when lower(coalesce(p_adjustment_kind, 'discount')) = 'discount'
      then greatest(0, base - delta)
    else base + delta
  end
  from d;
$$;

-- ---------------------------------------------------------------------------
-- 6) fn_billing_collection_action(days_overdue, has_default_card) — BN-13 (D12)
--    Matriz canônica de dunning. Fonte única; collectionPolicy.ts vira wrapper.
--    Retorno jsonb: { type, prefer, label, day }
--      type ∈ collect | notify | block | noop
--      prefer ∈ card | pix (só em collect)
--    Regras (clarificação 2026-09-04):
--      D0            → collect (card se houver; senão pix)
--      D1 / D3 / D5  → com cartão: collect card; sem cartão: notify (só WA)
--      D2 / D4 / D6  → noop
--      D7+           → block
-- ---------------------------------------------------------------------------
create or replace function public.fn_billing_collection_action(
  p_days_overdue     integer,
  p_has_default_card boolean
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with n as (
    select greatest(0, coalesce(p_days_overdue, 0)) as d,
           coalesce(p_has_default_card, false)      as has_card
  )
  select case
    when d >= 7 then jsonb_build_object('type', 'block', 'day', d)
    when d = 0 then jsonb_build_object(
      'type', 'collect',
      'prefer', case when has_card then 'card' else 'pix' end,
      'label', 'd0', 'day', 0
    )
    when d in (1, 3, 5) then
      case when has_card then
        jsonb_build_object('type', 'collect', 'prefer', 'card',
          'label', 'd' || d::text, 'day', d)
      else
        jsonb_build_object('type', 'notify', 'day', d)
      end
    else jsonb_build_object('type', 'noop', 'day', d)
  end
  from n;
$$;

-- ---------------------------------------------------------------------------
-- Grants: revoga de public; concede execute a service_role e authenticated.
-- (Leitura para UX é via RPC/route; TS não reimplementa a regra.)
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.fn_billing_next_due(timestamptz, text)',
    'public.fn_billing_prorate_cents(integer, integer, integer)',
    'public.fn_billing_monthly_charge_cents(integer, integer, integer, integer)',
    'public.fn_billing_apply_promo_cents(integer, text, text, integer)',
    'public.fn_billing_collection_action(integer, boolean)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to service_role', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

comment on function public.fn_billing_next_due(timestamptz, text) is
  'ADR-0006 D10: próximo vencimento month|year. Fonte única (substitui +1m em TS/SQL).';
comment on function public.fn_billing_collection_action(integer, boolean) is
  'ADR-0006 D12 / BN-13: matriz dunning D0–D7 (retry D1/D3/D5; block D7). Fonte única.';
