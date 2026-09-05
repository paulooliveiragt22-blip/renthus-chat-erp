-- Views postgres-owned sem security_invoker bypassam RLS (advisor security_definer_view).
-- Docs: Supabase RLS views (Context7 /websites/supabase) — ALTER VIEW SET (security_invoker = true)
-- + REVOKE write de anon/authenticated. SELECT só service_role (API admin).
-- App já lê via createAdminClient(); browser não deve SELECT view.

do $$
declare
  v text;
  views text[] := array[
    'v_aging_receivables',
    'v_cash_flow_projected',
    'v_company_delivery_policy',
    'v_company_delivery_rules',
    'v_dre',
    'v_fin_cash_session',
    'v_fin_dre',
    'v_fin_extrato',
    'v_fin_journal_trace',
    'v_whatsapp_usage_current_month',
    'view_categories',
    'view_chat_produtos',
    'view_pdv_produtos',
    'view_products_estoque',
    'view_produto_embalagem_acompanhamentos',
    'view_produtos_lista',
    'view_siglas_comerciais',
    'view_unit_types'
  ];
begin
  foreach v in array views
  loop
    if exists (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = v
         and c.relkind in ('v', 'm')
    ) then
      execute format('alter view public.%I set (security_invoker = true)', v);
      execute format('revoke all on table public.%I from anon', v);
      execute format('revoke all on table public.%I from authenticated', v);
      execute format('revoke all on table public.%I from public', v);
      execute format('grant select on table public.%I to service_role', v);
    end if;
  end loop;
end $$;
