-- RBAC: perfis + profile_id; staff → member (drop check antes do update).

create table if not exists public.company_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  template_key text not null
    check (template_key = any (array['cashier','kitchen','driver','waiter','custom']::text[])),
  capabilities text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_staff_profiles_name_len check (char_length(trim(name)) between 1 and 80)
);

create index if not exists company_staff_profiles_company_id_idx
  on public.company_staff_profiles (company_id);

create unique index if not exists company_staff_profiles_company_name_uq
  on public.company_staff_profiles (company_id, lower(trim(name)));

create unique index if not exists company_staff_profiles_company_template_uq
  on public.company_staff_profiles (company_id, template_key)
  where template_key <> 'custom';

alter table public.company_staff_profiles enable row level security;
alter table public.company_staff_profiles force row level security;

drop policy if exists rls_company_staff_profiles_service_role_only on public.company_staff_profiles;
create policy rls_company_staff_profiles_service_role_only on public.company_staff_profiles
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.company_staff_profiles from anon;
revoke all on table public.company_staff_profiles from authenticated;

alter table public.company_users
  add column if not exists profile_id uuid references public.company_staff_profiles (id) on delete set null;

create index if not exists company_users_profile_id_idx
  on public.company_users (profile_id);

alter table public.company_users
  drop constraint if exists company_users_role_check;

update public.company_users
   set role = 'member'
 where role = 'staff';

insert into public.company_staff_profiles (company_id, name, template_key, capabilities, is_active)
select distinct cu.company_id,
       'Atendente / Caixa',
       'cashier',
       array[
         'pdv.access','orders.read','orders.write','orders.status',
         'customers.read','customers.write','products.read',
         'print.operate','dashboard.view','whatsapp.operate'
       ]::text[],
       true
  from public.company_users cu
 where cu.role = 'member'
   and cu.profile_id is null
   and not exists (
     select 1 from public.company_staff_profiles p
      where p.company_id = cu.company_id and p.template_key = 'cashier'
   );

update public.company_users cu
   set profile_id = p.id
  from public.company_staff_profiles p
 where cu.role = 'member'
   and cu.profile_id is null
   and p.company_id = cu.company_id
   and p.template_key = 'cashier';

update public.company_users
   set profile_id = null
 where role in ('owner', 'admin')
   and profile_id is not null;

alter table public.company_users
  add constraint company_users_role_check
  check (role = any (array['owner'::text, 'admin'::text, 'member'::text]));

alter table public.company_users
  drop constraint if exists company_users_profile_role_ck;

alter table public.company_users
  add constraint company_users_profile_role_ck
  check (
    (role = 'member' and profile_id is not null)
    or (role in ('owner', 'admin') and profile_id is null)
  );

comment on table public.company_staff_profiles is
  'Perfis RBAC por empresa: capabilities text[] do catalogo em codigo.';

comment on column public.company_users.profile_id is
  'Obrigatorio para role=member; null para owner/admin.';
