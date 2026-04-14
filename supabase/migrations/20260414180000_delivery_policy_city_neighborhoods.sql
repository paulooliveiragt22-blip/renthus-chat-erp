-- Delivery v2: política por cidade/bairro (descontinua uso de delivery_zones no app).
-- Mantemos a tabela legacy delivery_zones por compatibilidade histórica.

create table if not exists public.city_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  state text null,
  neighborhood text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (city, state, neighborhood)
);

create table if not exists public.company_delivery_policy (
  company_id uuid primary key references public.companies(id) on delete cascade,
  service_city text null,
  service_state text null,
  service_by_zone boolean not null default false,
  default_mode text not null default 'all_city'
    check (default_mode in ('all_city', 'allow_list', 'deny_list')),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_delivery_neighborhood_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  city text not null,
  neighborhood text not null,
  is_served boolean not null default true,
  fee_override numeric null check (fee_override is null or fee_override >= 0),
  min_order_override numeric null check (min_order_override is null or min_order_override >= 0),
  eta_override_min integer null check (eta_override_min is null or eta_override_min >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, city, neighborhood)
);

create index if not exists city_neighborhoods_city_state_idx
  on public.city_neighborhoods(city, state);

create index if not exists company_delivery_rules_company_city_idx
  on public.company_delivery_neighborhood_rules(company_id, city, is_active);

-- Garante política default por empresa.
insert into public.company_delivery_policy (company_id, service_city, service_state, service_by_zone, default_mode)
select
  c.id,
  c.cidade,
  c.uf,
  false,
  'all_city'
from public.companies c
on conflict (company_id) do nothing;

-- Migração de dados legacy: cada delivery_zones.label vira um bairro "atendido".
insert into public.company_delivery_neighborhood_rules (
  company_id, city, neighborhood, is_served, fee_override, is_active
)
select
  z.company_id,
  coalesce(nullif(c.cidade, ''), 'Cidade não informada'),
  z.label,
  true,
  z.fee,
  z.is_active
from public.delivery_zones z
join public.companies c on c.id = z.company_id
on conflict (company_id, city, neighborhood)
do update set
  is_served = excluded.is_served,
  fee_override = excluded.fee_override,
  is_active = excluded.is_active,
  updated_at = now();

-- Se havia zonas legadas, define modo por zona em allow_list.
update public.company_delivery_policy p
set service_by_zone = true,
    default_mode = 'allow_list',
    updated_at = now()
where exists (
  select 1
  from public.delivery_zones z
  where z.company_id = p.company_id
);
