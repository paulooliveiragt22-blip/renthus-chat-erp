-- Lista anual: desconto editável (% ou R$) → price_year_cents derivado (R3-5 UX).
-- Promo continua em plan_promotions (active = kill-switch antes do fim da janela).

alter table public.plans
  add column if not exists yearly_discount_mode text not null default 'percent',
  add column if not exists yearly_discount_value integer not null default 2000;

alter table public.plans
  drop constraint if exists plans_yearly_discount_mode_check;
alter table public.plans
  add constraint plans_yearly_discount_mode_check
  check (yearly_discount_mode in ('percent', 'fixed_brl'));

alter table public.plans
  drop constraint if exists plans_yearly_discount_value_check;
alter table public.plans
  add constraint plans_yearly_discount_value_check
  check (yearly_discount_value >= 0);

comment on column public.plans.yearly_discount_mode is
  'percent = centésimos de % (2000 = 20,00%); fixed_brl = centavos de desconto no anual (mensal×12).';
comment on column public.plans.yearly_discount_value is
  'Valor do desconto anual conforme yearly_discount_mode. price_year_cents é derivado.';

-- Backfill: se anual ≈ −20% da lista, mantém percent 20%; senão estima fixed a partir da diferença.
update public.plans p
set
  yearly_discount_mode = case
    when p.price_cents > 0
      and p.price_year_cents is not null
      and abs(
        p.price_year_cents
        - round(p.price_cents * 12 * 0.8)
      ) <= 2
    then 'percent'
    when p.price_cents > 0 and p.price_year_cents is not null
    then 'fixed_brl'
    else 'percent'
  end,
  yearly_discount_value = case
    when p.price_cents > 0
      and p.price_year_cents is not null
      and abs(
        p.price_year_cents
        - round(p.price_cents * 12 * 0.8)
      ) <= 2
    then 2000
    when p.price_cents > 0 and p.price_year_cents is not null
    then greatest(0, (p.price_cents * 12) - p.price_year_cents)
    else 2000
  end
where p.key in ('essencial', 'pro', 'market');

-- Recalcula price_year_cents a partir do desconto (fonte canônica).
update public.plans p
set price_year_cents = greatest(
  0,
  case
    when p.yearly_discount_mode = 'fixed_brl' then
      (p.price_cents * 12) - p.yearly_discount_value
    else
      (p.price_cents * 12)
      - round((p.price_cents * 12)::numeric * p.yearly_discount_value / 10000.0)
  end
)
where p.key in ('essencial', 'pro', 'market');
