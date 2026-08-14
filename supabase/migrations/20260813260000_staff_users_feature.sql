-- M3: feature staff_users (Pro + Market) + CHECK de role em company_users + lookup auth email.

insert into public.features (key, description)
values ('staff_users', 'Cadastro de usuários da equipe com papéis')
on conflict (key) do update set description = excluded.description;

insert into public.plan_features (plan_id, feature_key)
select p.id, 'staff_users'
  from public.plans p
 where p.key in ('pro', 'market')
   and not exists (
     select 1
       from public.plan_features pf
      where pf.plan_id = p.id
        and pf.feature_key = 'staff_users'
   );

alter table public.company_users
  drop constraint if exists company_users_role_check;

alter table public.company_users
  add constraint company_users_role_check
  check (role = any (array['owner'::text, 'admin'::text, 'staff'::text]));

create or replace function public.rpc_find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = auth, public, pg_temp
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;
$$;

revoke all on function public.rpc_find_auth_user_id_by_email(text) from public;
revoke all on function public.rpc_find_auth_user_id_by_email(text) from anon, authenticated;
grant execute on function public.rpc_find_auth_user_id_by_email(text) to service_role;

comment on function public.rpc_find_auth_user_id_by_email(text) is
  'M3: resolve auth.users.id por e-mail (somente service_role).';
