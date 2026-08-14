-- Convergência do Grupo C (auditoria 2026-08-11, decisão do dono 2026-08-12):
-- 10 tabelas criadas após 20260414071525 tinham RLS company-scoped (via company_users) +
-- grants a anon/authenticated. Nenhum call site client-side existe — 100% do acesso é
-- createAdminClient() (service_role) ou RPC SECURITY DEFINER. Padrão do resto do banco:
-- REVOKE + FORCE + policy única service_role_only.
-- Views genéricas v_sec_* NÃO são recriadas (dropadas em 20260414072621 como lixo técnico;
-- leitura de domínio continua em views/RPCs específicas, mutação em RPC/API).
-- Confirmado no código antes de aplicar: zero .from() dessas tabelas em .tsx.

do $$
declare
  r record;
  pol record;
  pol_name text;
begin
  for r in
    select unnest(array[
      'company_menu_profile',
      'customer_channel_identities',
      'dining_tables',
      'marketplace_catalog_map',
      'marketplace_connections',
      'marketplace_external_orders',
      'menu_page_events',
      'meta_messaging_channels',
      'table_session_items',
      'table_sessions'
    ]) as table_name
  loop
    execute format('revoke all on table public.%I from anon', r.table_name);
    execute format('revoke all on table public.%I from authenticated', r.table_name);

    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('alter table public.%I force row level security', r.table_name);

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = r.table_name
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, r.table_name);
    end loop;

    pol_name := format('rls_%s_service_role_only', r.table_name);
    execute format(
      'create policy %I on public.%I as permissive for all to public using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
      pol_name,
      r.table_name
    );
  end loop;
end $$;
