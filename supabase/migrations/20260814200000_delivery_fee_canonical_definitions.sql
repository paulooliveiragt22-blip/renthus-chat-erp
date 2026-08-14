-- Taxa de entrega canônica: só service_fee_definitions (system_key=delivery).
-- Remove dual-path companies.default_delivery_fee / delivery_fee_enabled.

-- 1) Último sync companies → definição (só fixed; % já vive só na definição)
update public.service_fee_definitions d
   set value = coalesce(c.default_delivery_fee, d.value),
       is_active = coalesce(c.delivery_fee_enabled, d.is_active),
       updated_at = now()
  from public.companies c
 where d.company_id = c.id
   and d.system_key = 'delivery'
   and d.calc_mode = 'fixed';

insert into public.service_fee_definitions (
  company_id, name, slug, system_key, calc_mode, value, is_active, sort_order
)
select
  c.id,
  'Taxa de entrega',
  'taxa-entrega',
  'delivery',
  'fixed',
  coalesce(c.default_delivery_fee, 0),
  coalesce(c.delivery_fee_enabled, true),
  10
from public.companies c
where not exists (
  select 1 from public.service_fee_definitions d
   where d.company_id = c.id and d.system_key = 'delivery'
);

-- 2) View sem colunas de taxa em companies
drop view if exists public.v_company_delivery_policy;

create view public.v_company_delivery_policy as
select
  c.id as company_id,
  c.nome_fantasia,
  c.cidade as company_city,
  c.uf as company_state,
  c.settings,
  p.service_city,
  p.service_state,
  p.service_by_zone,
  p.default_mode,
  coalesce(p.deliveries_enabled, true) as deliveries_enabled,
  coalesce(p.pickup_enabled, true) as pickup_enabled,
  p.updated_at as policy_updated_at
from public.companies c
left join public.company_delivery_policy p
  on p.company_id = c.id;

grant select on public.v_company_delivery_policy to authenticated, service_role;

-- 3) RPC upsert sem espelho em companies
create or replace function public.rpc_upsert_service_fee_definition(
  p_company_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_name text;
  v_slug text;
  v_key text;
  v_mode text;
  v_value numeric;
  v_active boolean;
  v_sort int;
begin
  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;
  v_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  v_slug := nullif(trim(coalesce(p_payload ->> 'slug', '')), '');
  v_key := nullif(trim(coalesce(p_payload ->> 'system_key', '')), '');
  v_mode := coalesce(nullif(trim(p_payload ->> 'calc_mode'), ''), 'fixed');
  v_value := coalesce((p_payload ->> 'value')::numeric, 0);
  v_active := coalesce((p_payload ->> 'is_active')::boolean, true);
  v_sort := coalesce((p_payload ->> 'sort_order')::int, 100);

  if v_name is null then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if v_slug is null then
    v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then
      v_slug := 'taxa-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    end if;
  end if;
  if v_mode not in ('fixed', 'percent') then
    raise exception 'invalid_calc_mode' using errcode = '22023';
  end if;
  if v_key is not null and v_key not in ('delivery', 'service', 'other') then
    raise exception 'invalid_system_key' using errcode = '22023';
  end if;
  if v_mode = 'percent' and v_value > 100 then
    raise exception 'percent_out_of_range' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.service_fee_definitions (
      company_id, name, slug, system_key, calc_mode, value, is_active, sort_order
    ) values (
      p_company_id, v_name, v_slug, v_key, v_mode, v_value, v_active, v_sort
    )
    returning id into v_id;
  else
    update public.service_fee_definitions
       set name = v_name,
           slug = v_slug,
           system_key = v_key,
           calc_mode = v_mode,
           value = v_value,
           is_active = v_active,
           sort_order = v_sort,
           updated_at = now()
     where id = v_id and company_id = p_company_id
    returning id into v_id;
    if v_id is null then
      raise exception 'fee_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.rpc_upsert_service_fee_definition(uuid, jsonb) from public;
revoke all on function public.rpc_upsert_service_fee_definition(uuid, jsonb) from anon, authenticated;
grant execute on function public.rpc_upsert_service_fee_definition(uuid, jsonb) to service_role;

-- 4) Drop colunas legadas
alter table public.companies drop column if exists default_delivery_fee;
alter table public.companies drop column if exists delivery_fee_enabled;
