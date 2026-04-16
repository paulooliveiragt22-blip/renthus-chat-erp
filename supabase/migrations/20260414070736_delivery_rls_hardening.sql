-- Security hardening (Delivery domain)
-- Objetivo: sem acesso cru às tabelas de delivery para anon/authenticated.
-- Acesso de app deve ocorrer por API server-side (service_role) e/ou views/RPCs aprovadas.

-- 1) RLS ligado + forçado
alter table if exists public.city_neighborhoods enable row level security;
alter table if exists public.city_neighborhoods force row level security;

alter table if exists public.company_delivery_policy enable row level security;
alter table if exists public.company_delivery_policy force row level security;

alter table if exists public.company_delivery_neighborhood_rules enable row level security;
alter table if exists public.company_delivery_neighborhood_rules force row level security;

alter table if exists public.delivery_zones enable row level security;
alter table if exists public.delivery_zones force row level security;

-- 2) Limpa políticas antigas nesses objetos (idempotente)
drop policy if exists city_neighborhoods_service_role_all on public.city_neighborhoods;
drop policy if exists company_delivery_policy_service_role_all on public.company_delivery_policy;
drop policy if exists company_delivery_rules_service_role_all on public.company_delivery_neighborhood_rules;
drop policy if exists delivery_zones_service_role_all on public.delivery_zones;

-- 3) Política única: somente service_role
create policy city_neighborhoods_service_role_all
on public.city_neighborhoods
as permissive
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy company_delivery_policy_service_role_all
on public.company_delivery_policy
as permissive
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy company_delivery_rules_service_role_all
on public.company_delivery_neighborhood_rules
as permissive
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy delivery_zones_service_role_all
on public.delivery_zones
as permissive
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- 4) Remove grants diretos de tabela para perfis web
revoke all on table public.city_neighborhoods from anon, authenticated;
revoke all on table public.company_delivery_policy from anon, authenticated;
revoke all on table public.company_delivery_neighborhood_rules from anon, authenticated;
revoke all on table public.delivery_zones from anon, authenticated;

-- 5) Views podem ser lidas (se desejado) por perfis web
grant select on public.v_company_delivery_policy to authenticated;
grant select on public.v_company_delivery_rules to authenticated;

-- 6) RPCs de delivery: mantém só service_role por padrão (server-side)
revoke all on function public.upsert_company_delivery_policy(uuid, text, text, boolean, text) from anon, authenticated;
revoke all on function public.upsert_company_delivery_rule(uuid, text, text, boolean, numeric, numeric, integer, boolean) from anon, authenticated;
revoke all on function public.delete_company_delivery_rule(uuid, text, text) from anon, authenticated;
revoke all on function public.replace_company_delivery_rules(uuid, text, jsonb) from anon, authenticated;

grant execute on function public.upsert_company_delivery_policy(uuid, text, text, boolean, text) to service_role;
grant execute on function public.upsert_company_delivery_rule(uuid, text, text, boolean, numeric, numeric, integer, boolean) to service_role;
grant execute on function public.delete_company_delivery_rule(uuid, text, text) to service_role;
grant execute on function public.replace_company_delivery_rules(uuid, text, jsonb) to service_role;
