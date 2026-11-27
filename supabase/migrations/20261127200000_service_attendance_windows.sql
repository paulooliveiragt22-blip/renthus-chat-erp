-- Expediente do atendimento (dia da semana, até dois turnos).
-- Não altera company_settings.opening_periods, que continua sendo o horário da loja de delivery.
-- Sem janelas salvas, a marcação segue no opening_periods. Com janelas, dia sem turno fica fechado.

alter table public.service_profiles
  add column if not exists attendance_windows jsonb not null default '[]'::jsonb;

alter table public.service_profiles
  drop constraint if exists service_profiles_attendance_windows_check;

alter table public.service_profiles
  add constraint service_profiles_attendance_windows_check
  check (
    jsonb_typeof(attendance_windows) = 'array'
    and jsonb_array_length(attendance_windows) <= 14
  );

alter table public.service_appointments
  add column if not exists label text;

alter table public.service_appointments
  drop constraint if exists service_appointments_label_len;

alter table public.service_appointments
  add constraint service_appointments_label_len
  check (label is null or char_length(label) <= 120);

create or replace function public.fn_service_periods_for(
  p_company_id uuid,
  p_dow integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_windows jsonb;
  v_fallback jsonb;
begin
  select p.attendance_windows into v_windows
  from public.service_profiles p
  where p.company_id = p_company_id;

  if v_windows is not null
    and jsonb_typeof(v_windows) = 'array'
    and jsonb_array_length(v_windows) > 0
  then
    return coalesce((
      select jsonb_agg(jsonb_build_object('open', e->>'open', 'close', e->>'close'))
      from jsonb_array_elements(v_windows) as t(e)
      where (e->>'dow') ~ '^[0-6]$'
        and (e->>'dow')::integer = p_dow
    ), '[]'::jsonb);
  end if;

  select c.periods into v_fallback
  from public.fn_service_company_clock(p_company_id) c;
  return coalesce(v_fallback, '[]'::jsonb);
end;
$$;

create or replace function public.fn_service_starts_allowed(
  p_company_id uuid,
  p_starts_at timestamptz,
  p_duration integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_periods jsonb;
  v_local timestamp;
  v_min integer;
  v_elem jsonb;
  v_open integer;
  v_close integer;
begin
  if p_starts_at is null or p_duration is null then
    return false;
  end if;
  select c.time_zone into v_tz
  from public.fn_service_company_clock(p_company_id) c;
  v_local := p_starts_at at time zone coalesce(v_tz, 'America/Cuiaba');
  v_periods := public.fn_service_periods_for(p_company_id, extract(dow from v_local)::integer);
  if v_periods is null or jsonb_typeof(v_periods) <> 'array' or jsonb_array_length(v_periods) = 0 then
    return false;
  end if;
  if extract(second from v_local) <> 0 then
    return false;
  end if;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  for v_elem in select value from jsonb_array_elements(v_periods)
  loop
    v_open := public.fn_service_hhmm_minutes(coalesce(v_elem->>'open', v_elem->>'openTime'));
    v_close := public.fn_service_hhmm_minutes(coalesce(v_elem->>'close', v_elem->>'closeTime'));
    if public.fn_service_slot_fits(v_min, p_duration, v_open, v_close) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.fn_service_free_starts(
  p_company_id uuid,
  p_offering_id uuid,
  p_day date
)
returns setof timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_periods jsonb;
  v_duration integer;
  v_elem jsonb;
  v_open integer;
  v_close integer;
  v_min integer;
  v_limit integer;
  v_slot timestamptz;
  v_emitted integer := 0;
begin
  select o.duration_min into v_duration
  from public.service_offerings o
  where o.id = p_offering_id
    and o.company_id = p_company_id
    and o.active
    and o.duration_min is not null;
  if v_duration is null then
    return;
  end if;

  select c.time_zone into v_tz
  from public.fn_service_company_clock(p_company_id) c;
  v_periods := public.fn_service_periods_for(p_company_id, extract(dow from p_day)::integer);
  if v_periods is null or jsonb_typeof(v_periods) <> 'array' or jsonb_array_length(v_periods) = 0 then
    return;
  end if;

  for v_elem in select value from jsonb_array_elements(v_periods)
  loop
    v_open := public.fn_service_hhmm_minutes(coalesce(v_elem->>'open', v_elem->>'openTime'));
    v_close := public.fn_service_hhmm_minutes(coalesce(v_elem->>'close', v_elem->>'closeTime'));
    if v_open is null or v_close is null then
      continue;
    end if;

    if v_open = v_close then
      v_min := 0;
      v_limit := 1440;
    elsif v_close > v_open then
      v_min := v_open;
      v_limit := v_close;
    else
      v_min := v_open;
      v_limit := 1440;
    end if;

    while v_min + v_duration <= v_limit and v_emitted < 48 loop
      v_slot := (p_day::timestamp + make_interval(mins => v_min)) at time zone coalesce(v_tz, 'America/Cuiaba');
      if v_slot > now()
        and not exists (
          select 1
          from public.service_appointments a
          where a.company_id = p_company_id
            and a.status = 'confirmed'
            and a.during && tstzrange(v_slot, v_slot + make_interval(mins => v_duration), '[)')
        )
      then
        v_emitted := v_emitted + 1;
        return next v_slot;
      end if;
      v_min := v_min + v_duration;
    end loop;

    if v_close < v_open then
      v_min := 0;
      while v_min + v_duration <= v_close and v_emitted < 48 loop
        v_slot := (p_day::timestamp + make_interval(mins => v_min)) at time zone coalesce(v_tz, 'America/Cuiaba');
        if v_slot > now()
          and not exists (
            select 1
            from public.service_appointments a
            where a.company_id = p_company_id
              and a.status = 'confirmed'
              and a.during && tstzrange(v_slot, v_slot + make_interval(mins => v_duration), '[)')
          )
        then
          v_emitted := v_emitted + 1;
          return next v_slot;
        end if;
        v_min := v_min + v_duration;
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function public.rpc_service_get_attendance_windows(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_windows jsonb;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'windows', '[]'::jsonb);
  end if;
  select p.attendance_windows into v_windows
  from public.service_profiles p
  where p.company_id = p_company_id;
  return jsonb_build_object('ok', true, 'code', 'ok', 'windows', coalesce(v_windows, '[]'::jsonb));
end;
$$;

create or replace function public.rpc_service_set_attendance_windows(
  p_company_id uuid,
  p_windows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_elem jsonb;
  v_dow integer;
  v_open integer;
  v_close integer;
  v_clean jsonb := '[]'::jsonb;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  if not exists (select 1 from public.service_profiles p where p.company_id = p_company_id) then
    return jsonb_build_object('ok', false, 'code', 'agenda_off');
  end if;
  if p_windows is null or jsonb_typeof(p_windows) is distinct from 'array' or jsonb_array_length(p_windows) > 14 then
    return jsonb_build_object('ok', false, 'code', 'invalid_window');
  end if;

  for v_elem in select value from jsonb_array_elements(p_windows)
  loop
    if (v_elem->>'dow') !~ '^[0-6]$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_window');
    end if;
    v_dow := (v_elem->>'dow')::integer;
    v_open := public.fn_service_hhmm_minutes(v_elem->>'open');
    v_close := public.fn_service_hhmm_minutes(v_elem->>'close');
    if v_open is null or v_close is null or v_close <= v_open then
      return jsonb_build_object('ok', false, 'code', 'invalid_window');
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'dow', v_dow,
      'open', lpad((v_open / 60)::text, 2, '0') || ':' || lpad((v_open % 60)::text, 2, '0'),
      'close', lpad((v_close / 60)::text, 2, '0') || ':' || lpad((v_close % 60)::text, 2, '0')
    ));
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(v_clean) as t(e)
    group by e->>'dow'
    having count(*) > 2
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_window');
  end if;

  update public.service_profiles
    set attendance_windows = v_clean,
        updated_at = now()
    where company_id = p_company_id;

  return jsonb_build_object('ok', true, 'code', 'ok', 'windows', v_clean);
end;
$$;

drop function if exists public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid);

create or replace function public.rpc_service_admin_book(
  p_company_id uuid,
  p_idempotency_key text,
  p_offering_id uuid,
  p_starts_at timestamptz,
  p_phone_e164 text,
  p_customer_name text,
  p_case_id uuid,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_id uuid;
  v_label text;
begin
  v_result := public.fn_service_insert_appointment(
    p_company_id,
    'admin',
    p_idempotency_key,
    p_offering_id,
    p_starts_at,
    p_phone_e164,
    p_customer_name,
    null,
    null,
    p_case_id,
    null
  );
  v_label := left(btrim(coalesce(p_label, '')), 120);
  if coalesce(v_result->>'ok', '') = 'true' and char_length(v_label) > 0 then
    v_id := nullif(v_result->>'appointment_id', '')::uuid;
    update public.service_appointments
      set label = v_label
      where id = v_id
        and company_id = p_company_id;
  end if;
  return v_result;
end;
$$;

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
  if p_from is null or p_to is null or p_to <= p_from or p_to > p_from + interval '370 days' then
    return jsonb_build_object('ok', false, 'code', 'google_invalid', 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(row_to_json(x) order by x.starts_at)
      from (
        select a.id, a.offering_name, a.starts_at, a.ends_at, a.phone_e164, a.customer_name,
               a.label, a.google_event_id, a.google_sync, a.source
        from public.service_appointments a
        where a.company_id = p_company_id
          and a.status = 'confirmed'
          and a.starts_at >= p_from
          and a.starts_at < p_to
        order by a.starts_at
        limit 400
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_service_appointment_mirror(
  p_company_id uuid,
  p_appointment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.service_appointments%rowtype;
  v_tz text;
begin
  select * into v_row
  from public.service_appointments a
  where a.id = p_appointment_id
    and a.company_id = p_company_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  select c.time_zone into v_tz from public.fn_service_company_clock(p_company_id) c;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'appointment_id', v_row.id,
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'offering_name', v_row.offering_name,
    'customer_name', v_row.customer_name,
    'label', v_row.label,
    'google_event_id', v_row.google_event_id,
    'status', v_row.status,
    'time_zone', coalesce(v_tz, 'America/Cuiaba')
  );
end;
$$;

revoke all on function public.fn_service_periods_for(uuid, integer) from public, anon, authenticated;
revoke all on function public.fn_service_starts_allowed(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.fn_service_free_starts(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.rpc_service_get_attendance_windows(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_set_attendance_windows(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_service_list_appointments_range(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_service_appointment_mirror(uuid, uuid) from public, anon, authenticated;

grant execute on function public.fn_service_periods_for(uuid, integer) to service_role;
grant execute on function public.fn_service_starts_allowed(uuid, timestamptz, integer) to service_role;
grant execute on function public.fn_service_free_starts(uuid, uuid, date) to service_role;
grant execute on function public.rpc_service_get_attendance_windows(uuid) to service_role;
grant execute on function public.rpc_service_set_attendance_windows(uuid, jsonb) to service_role;
grant execute on function public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid, text) to service_role;
grant execute on function public.rpc_service_list_appointments_range(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.rpc_service_appointment_mirror(uuid, uuid) to service_role;
