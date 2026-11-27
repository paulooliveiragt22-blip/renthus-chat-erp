create or replace function public.rpc_service_list_appointments_range(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_agenda boolean;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'rows', '[]'::jsonb);
  end if;
  select p.agenda_enabled into v_agenda from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_agenda, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'agenda_off', 'rows', '[]'::jsonb);
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to > p_from + interval '62 days' then
    return jsonb_build_object('ok', false, 'code', 'google_invalid', 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(row_to_json(x) order by x.starts_at)
      from (
        select a.id, a.offering_name, a.starts_at, a.ends_at, a.phone_e164, a.customer_name,
               a.google_event_id, a.google_sync, a.source
        from public.service_appointments a
        where a.company_id = p_company_id
          and a.status = 'confirmed'
          and a.starts_at >= p_from
          and a.starts_at < p_to
        order by a.starts_at
        limit 200
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rpc_service_list_appointments_range(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.rpc_service_list_appointments_range(uuid, timestamptz, timestamptz) to service_role;
