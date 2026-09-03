-- C1b.2: meta do handoff bot → cardápio (ex.: fulfillment_type) sem serializar na URL.
-- Leitura/mutação só service_role (policy existente).

alter table public.menu_handoffs
  add column if not exists meta jsonb not null default '{}'::jsonb;

comment on column public.menu_handoffs.meta is
  'Extras do handoff (ex.: {"fulfillment_type":"delivery"}); carrinho continua em cart.';
