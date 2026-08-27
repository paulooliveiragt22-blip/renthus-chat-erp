-- P2.2: bucket privado de archive + RPC de purge em batch

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'platform-audit-archive',
  'platform-audit-archive',
  false,
  52428800, -- 50 MB
  array['application/json', 'application/gzip', 'application/x-gzip', 'text/csv']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists platform_audit_archive_select on storage.objects;
create policy platform_audit_archive_select
  on storage.objects for select to public
  using (bucket_id = 'platform-audit-archive' and auth.role() = 'service_role');

drop policy if exists platform_audit_archive_insert on storage.objects;
create policy platform_audit_archive_insert
  on storage.objects for insert to public
  with check (bucket_id = 'platform-audit-archive' and auth.role() = 'service_role');

drop policy if exists platform_audit_archive_update on storage.objects;
create policy platform_audit_archive_update
  on storage.objects for update to public
  using (bucket_id = 'platform-audit-archive' and auth.role() = 'service_role')
  with check (bucket_id = 'platform-audit-archive' and auth.role() = 'service_role');

drop policy if exists platform_audit_archive_delete on storage.objects;
create policy platform_audit_archive_delete
  on storage.objects for delete to public
  using (bucket_id = 'platform-audit-archive' and auth.role() = 'service_role');

create or replace function public.rpc_platform_delete_audit_by_ids(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  delete from public.platform_audit_log
   where id = any (p_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rpc_platform_delete_audit_by_ids(uuid[]) from public;
grant execute on function public.rpc_platform_delete_audit_by_ids(uuid[]) to service_role;

comment on function public.rpc_platform_delete_audit_by_ids(uuid[]) is
  'Purge batch de platform_audit_log após archive no Storage (service_role).';
