create or replace function public.rpc_service_delete_offering(
  p_company_id uuid,
  p_offering_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select c.attendance_mode into v_mode
  from public.companies c
  where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  if not exists (
    select 1
    from public.service_offerings o
    where o.id = p_offering_id
      and o.company_id = p_company_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  if exists (
    select 1
    from public.service_appointments a
    where a.offering_id = p_offering_id
      and a.company_id = p_company_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'offering_in_use');
  end if;

  delete from public.service_offerings
  where id = p_offering_id
    and company_id = p_company_id;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.rpc_service_delete_offering(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_service_delete_offering(uuid, uuid) to service_role;
