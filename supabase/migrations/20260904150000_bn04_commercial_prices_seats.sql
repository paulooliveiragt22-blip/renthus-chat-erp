-- BN-04 / R2: preços comerciais 279 / 349 / 449; anual −20% default; seats inclusos.
-- BN-05 setup = 0 (app). BN-07 trial self-serve já 0 em platform_billing_settings.

alter table public.plans
  add column if not exists price_year_cents integer,
  add column if not exists included_seats integer,
  add column if not exists seat_extra_cents integer;

comment on column public.plans.price_year_cents is
  'Lista anual editável (default sugerido = mensal×12×0,8). BN-04 / R2-B.';
comment on column public.plans.included_seats is
  'Usuários inclusos no preço do plano. BN-17 / R2-C.';
comment on column public.plans.seat_extra_cents is
  'Preço seat adicional /mês (centavos). NULL = sem venda de seat (Essencial cap).';

update public.plans
set
  name = 'Essencial',
  price_cents = 27900,
  price_year_cents = 267840,
  included_seats = 1,
  seat_extra_cents = null,
  description = 'WhatsApp + cardápio web + IA com crédito e packs · R$ 279/mês'
where key = 'essencial';

update public.plans
set
  name = 'Essencial (legado)',
  price_cents = 27900,
  price_year_cents = 267840,
  included_seats = 1,
  seat_extra_cents = null,
  description = 'Migrado para essencial'
where key = 'starter';

update public.plans
set
  name = 'Pro',
  price_cents = 34900,
  price_year_cents = 335040,
  included_seats = 1,
  seat_extra_cents = 9900,
  description = 'ERP completo + impressão automática + IA · R$ 349/mês'
where key = 'pro';

update public.plans
set
  name = 'Market',
  price_cents = 44900,
  price_year_cents = 431040,
  included_seats = 10,
  seat_extra_cents = 9900,
  description = 'Pro + iFood/Aiqfome + Instagram/Messenger + mesa · R$ 449/mês'
where key = 'market';

-- Alinha budget IA incluso ao 10% do mensal de lista (BN-06).
update public.company_ai_wallets w
set
  included_budget_cents = greatest(0, (p.price_cents * 10) / 100),
  updated_at = now()
from public.pagarme_subscriptions s
join public.plans p on p.id = s.plan_id
where w.company_id = s.company_id
  and s.plan_id is not null;
