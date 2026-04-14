-- Views e RPCs para delivery policy v2

create or replace view public.v_company_delivery_policy as
select
  c.id as company_id,
  c.nome_fantasia,
  c.cidade as company_city,
  c.uf as company_state,
  c.delivery_fee_enabled,
  c.default_delivery_fee,
  c.settings,
  p.service_city,
  p.service_state,
  p.service_by_zone,
  p.default_mode,
  p.updated_at as policy_updated_at
from public.companies c
left join public.company_delivery_policy p
  on p.company_id = c.id;

create or replace view public.v_company_delivery_rules as
select
  r.id,
  r.company_id,
  c.nome_fantasia,
  r.city,
  r.neighborhood,
  r.is_served,
  r.fee_override,
  r.min_order_override,
  r.eta_override_min,
  r.is_active,
  r.created_at,
  r.updated_at
from public.company_delivery_neighborhood_rules r
left join public.companies c
  on c.id = r.company_id;

create or replace function public.upsert_company_delivery_policy(
  p_company_id uuid,
  p_service_city text,
  p_service_state text,
  p_service_by_zone boolean,
  p_default_mode text
)
returns public.company_delivery_policy
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_row public.company_delivery_policy;
begin
  v_mode := case
    when p_default_mode in ('all_city','allow_list','deny_list') then p_default_mode
    else 'all_city'
  end;

  insert into public.company_delivery_policy (
    company_id, service_city, service_state, service_by_zone, default_mode, updated_at
  )
  values (
    p_company_id, nullif(trim(coalesce(p_service_city,'')), ''),
    nullif(trim(upper(coalesce(p_service_state,''))), ''),
    coalesce(p_service_by_zone, false),
    v_mode,
    now()
  )
  on conflict (company_id)
  do update set
    service_city = excluded.service_city,
    service_state = excluded.service_state,
    service_by_zone = excluded.service_by_zone,
    default_mode = excluded.default_mode,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.upsert_company_delivery_rule(
  p_company_id uuid,
  p_city text,
  p_neighborhood text,
  p_is_served boolean,
  p_fee_override numeric default null,
  p_min_order_override numeric default null,
  p_eta_override_min integer default null,
  p_is_active boolean default true
)
returns public.company_delivery_neighborhood_rules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city text;
  v_neighborhood text;
  v_row public.company_delivery_neighborhood_rules;
begin
  v_city := nullif(trim(coalesce(p_city, '')), '');
  v_neighborhood := nullif(trim(coalesce(p_neighborhood, '')), '');

  if v_city is null then
    raise exception 'city is required';
  end if;
  if v_neighborhood is null then
    raise exception 'neighborhood is required';
  end if;

  insert into public.company_delivery_neighborhood_rules (
    company_id, city, neighborhood, is_served, fee_override, min_order_override, eta_override_min, is_active, updated_at
  )
  values (
    p_company_id, v_city, v_neighborhood,
    coalesce(p_is_served, true),
    p_fee_override,
    p_min_order_override,
    p_eta_override_min,
    coalesce(p_is_active, true),
    now()
  )
  on conflict (company_id, city, neighborhood)
  do update set
    is_served = excluded.is_served,
    fee_override = excluded.fee_override,
    min_order_override = excluded.min_order_override,
    eta_override_min = excluded.eta_override_min,
    is_active = excluded.is_active,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_company_delivery_rule(
  p_company_id uuid,
  p_city text,
  p_neighborhood text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  delete from public.company_delivery_neighborhood_rules
  where company_id = p_company_id
    and city = p_city
    and neighborhood = p_neighborhood;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.replace_company_delivery_rules(
  p_company_id uuid,
  p_city text,
  p_rules jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city text;
  v_count integer := 0;
begin
  v_city := nullif(trim(coalesce(p_city, '')), '');
  if v_city is null then
    raise exception 'city is required';
  end if;

  delete from public.company_delivery_neighborhood_rules
  where company_id = p_company_id
    and city = v_city;

  insert into public.company_delivery_neighborhood_rules (
    company_id, city, neighborhood, is_served, fee_override, min_order_override, eta_override_min, is_active, updated_at
  )
  select
    p_company_id,
    v_city,
    trim(coalesce(x.neighborhood, '')) as neighborhood,
    coalesce(x.is_served, true),
    x.fee_override,
    x.min_order_override,
    x.eta_override_min,
    coalesce(x.is_active, true),
    now()
  from jsonb_to_recordset(coalesce(p_rules, '[]'::jsonb)) as x(
    neighborhood text,
    is_served boolean,
    fee_override numeric,
    min_order_override numeric,
    eta_override_min integer,
    is_active boolean
  )
  where nullif(trim(coalesce(x.neighborhood, '')), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant select on public.v_company_delivery_policy to authenticated, service_role;
grant select on public.v_company_delivery_rules to authenticated, service_role;
