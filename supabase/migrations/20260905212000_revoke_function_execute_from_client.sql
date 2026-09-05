-- SECURITY DEFINER com EXECUTE para anon/authenticated: PostgREST + anon key
-- chama rpc_platform_suspend_company, rpc_create_product_*, fulfill, etc.
-- Padrão do repo (supabase-migrations-seguranca.mdc): REVOKE PUBLIC; GRANT service_role.
-- Triggers continuam a correr (não dependem de GRANT ao caller HTTP).
-- Funções novas herdam default privileges abaixo.

do $$
declare
  r record;
begin
  for r in
    select n.nspname as nsp,
           p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      r.nsp, r.name, r.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      r.nsp, r.name, r.args
    );
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
alter default privileges in schema public grant execute on functions to service_role;

alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
