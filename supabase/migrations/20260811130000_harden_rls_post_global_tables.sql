-- Hardening RLS das 5 tabelas criadas depois de 20260414071525_global_rls_revoke_views_rpcs.sql
-- (loop global daquela migration não é retroativo — cada tabela nova precisa repetir o padrão
-- manualmente). Achado real (auditoria 2026-08-11, docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md
-- item 4): RLS habilitado mas SEM policy e SEM FORCE, com grants completos (SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE/TRIGGER/REFERENCES) ainda de pé para anon/authenticated em:
--   whatsapp_order_confirmations, abandoned_carts, outbound_jobs, pipeline_turn_traces,
--   pro_pipeline_metric_events
-- Confirmado antes de aplicar: todo acesso a essas tabelas no código é via createAdminClient()
-- (service-role, server-side) — nenhum SELECT/INSERT direto do browser/anon-key. Sem regressão
-- esperada. Mesmo padrão exato (REVOKE + FORCE + policy service_role_only) de
-- .cursor/rules/supabase-migrations-seguranca.mdc.

do $$
declare
  r record;
  pol record;
  pol_name text;
begin
  for r in
    select unnest(array[
      'whatsapp_order_confirmations',
      'abandoned_carts',
      'outbound_jobs',
      'pipeline_turn_traces',
      'pro_pipeline_metric_events'
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
