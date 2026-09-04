-- Comercial C1: seats quantity, billing period, invoice kinds year/seat_add, plan_promotions.

-- 1) Subscription commercial fields
alter table public.pagarme_subscriptions
  add column if not exists seat_quantity integer not null default 1,
  add column if not exists billing_period text not null default 'month',
  add column if not exists promo_id uuid null,
  add column if not exists promo_months_remaining integer null,
  add column if not exists promo_snapshot jsonb not null default '{}'::jsonb;

alter table public.pagarme_subscriptions
  drop constraint if exists pagarme_subscriptions_billing_period_check;
alter table public.pagarme_subscriptions
  add constraint pagarme_subscriptions_billing_period_check
  check (billing_period in ('month', 'year'));

alter table public.pagarme_subscriptions
  drop constraint if exists pagarme_subscriptions_seat_quantity_check;
alter table public.pagarme_subscriptions
  add constraint pagarme_subscriptions_seat_quantity_check
  check (seat_quantity >= 1);

comment on column public.pagarme_subscriptions.seat_quantity is
  'Capacidade de users pagos (inclusos + seats extras adquiridos). R3-3.';
comment on column public.pagarme_subscriptions.billing_period is
  'month | year. Anual sem promo (R3-2).';
comment on column public.pagarme_subscriptions.promo_snapshot is
  'Regra de promo congelada na adesão (R3-1).';

update public.pagarme_subscriptions s
set seat_quantity = greatest(coalesce(s.seat_quantity, 1), coalesce(p.included_seats, 1))
from public.plans p
where p.id = s.plan_id;

-- 2) Invoice kinds: year + seat_add
alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices
  add constraint invoices_kind_check
  check (kind in ('setup', 'subscription', 'year', 'seat_add', 'ai_pack'));

-- 3) plan_promotions (mensal only — R3-2)
create table if not exists public.plan_promotions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  name text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_months integer not null check (duration_months >= 1),
  adjustment_kind text not null check (adjustment_kind in ('discount', 'surcharge')),
  adjustment_mode text not null check (adjustment_mode in ('fixed_brl', 'percent')),
  adjustment_value integer not null check (adjustment_value >= 0),
  -- fixed_brl: centavos; percent: basis points (5000 = 50%)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_plan_promotions_plan_window
  on public.plan_promotions (plan_id, starts_at, ends_at)
  where active = true;

alter table public.plan_promotions enable row level security;
alter table public.plan_promotions force row level security;

revoke all on table public.plan_promotions from anon;
revoke all on table public.plan_promotions from authenticated;

drop policy if exists rls_plan_promotions_service_role_only on public.plan_promotions;
create policy rls_plan_promotions_service_role_only on public.plan_promotions
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- FK promo_id → plan_promotions (após tabela existir)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pagarme_subscriptions_promo_id_fkey'
  ) then
    alter table public.pagarme_subscriptions
      add constraint pagarme_subscriptions_promo_id_fkey
      foreign key (promo_id) references public.plan_promotions(id) on delete set null;
  end if;
end $$;
