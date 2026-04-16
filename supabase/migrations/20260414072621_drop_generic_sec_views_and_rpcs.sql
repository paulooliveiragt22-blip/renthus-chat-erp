-- Remove artefatos genéricos de segurança para evitar lixo técnico:
-- - views v_sec_*
-- - rpc_secure_insert/update/delete
-- Mantém hardening global (RLS + REVOKE) já aplicado.

drop function if exists public.rpc_secure_insert(text, jsonb);
drop function if exists public.rpc_secure_update(text, uuid, jsonb);
drop function if exists public.rpc_secure_delete(text, uuid);

do $$
declare
  r record;
begin
  for r in
    select table_name
    from information_schema.views
    where table_schema = 'public'
      and table_name like 'v_sec_%'
  loop
    execute format('drop view if exists public.%I', r.table_name);
  end loop;
end $$;
