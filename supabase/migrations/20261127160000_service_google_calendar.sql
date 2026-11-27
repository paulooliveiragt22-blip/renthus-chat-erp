-- Office: uma conta Google por empresa. O refresh token fica cifrado.
-- O Postgres continua a fonte do horário. O evento no Google é espelho.

alter table public.service_appointments
  add column if not exists google_event_id text,
  add column if not exists google_sync text;

alter table public.service_appointments
  drop constraint if exists service_appointments_google_event_len;

alter table public.service_appointments
  add constraint service_appointments_google_event_len
  check (google_event_id is null or char_length(google_event_id) between 1 and 1024);

alter table public.service_appointments
  drop constraint if exists service_appointments_google_sync_check;

alter table public.service_appointments
  add constraint service_appointments_google_sync_check
  check (google_sync is null or google_sync = any (array['synced'::text, 'failed'::text]));

comment on column public.service_appointments.google_event_id is
  'Id do evento na agenda Google. Nulo quando a empresa não conectou ou o espelho ainda não foi gravado.';

comment on column public.service_appointments.google_sync is
  'synced: o evento existe no Google. failed: a marcação no Postgres ficou e o espelho não. Nulo: sem tentativa.';

create table if not exists public.service_google_connections (
  company_id uuid primary key references public.companies (id) on delete cascade,
  google_email text not null,
  refresh_token_enc text not null,
  calendar_id text not null default 'primary',
  status text not null default 'connected',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_google_connections_email_len check (char_length(btrim(google_email)) between 3 and 320),
  constraint service_google_connections_token_len check (char_length(refresh_token_enc) between 20 and 4000),
  constraint service_google_connections_calendar_len check (char_length(btrim(calendar_id)) between 1 and 200),
  constraint service_google_connections_status_check check (status = any (array['connected'::text, 'revoked'::text]))
);

comment on table public.service_google_connections is
  'Uma agenda Google por empresa de serviço. refresh_token_enc é cifra AES, nunca volta ao browser.';

create index if not exists service_google_connections_company_idx
  on public.service_google_connections (company_id);

alter table public.service_google_connections enable row level security;
alter table public.service_google_connections force row level security;

revoke all on table public.service_google_connections from anon, authenticated;

drop policy if exists rls_service_google_connections_service_role_only on public.service_google_connections;
create policy rls_service_google_connections_service_role_only on public.service_google_connections
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.rpc_service_google_status(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_email text;
  v_status text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'connected', false);
  end if;

  select g.google_email, g.status into v_email, v_status
  from public.service_google_connections g
  where g.company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'connected', v_status = 'connected',
    'email', v_email,
    'link_status', v_status
  );
end;
$$;

create or replace function public.rpc_service_google_secret(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.service_google_connections%rowtype;
  v_mode text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  select * into v_row
  from public.service_google_connections g
  where g.company_id = p_company_id;

  if not found then
    return jsonb_build_object('ok', true, 'code', 'ok', 'connected', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'connected', v_row.status = 'connected',
    'email', v_row.google_email,
    'refresh_token_enc', v_row.refresh_token_enc,
    'calendar_id', v_row.calendar_id,
    'link_status', v_row.status
  );
end;
$$;

create or replace function public.rpc_service_google_connect(
  p_company_id uuid,
  p_email text,
  p_refresh_token_enc text,
  p_calendar_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_email text := btrim(p_email);
  v_token text := btrim(p_refresh_token_enc);
  v_calendar text := coalesce(nullif(btrim(p_calendar_id), ''), 'primary');
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  if v_email is null or position('@' in v_email) = 0 or char_length(v_email) > 320 then
    return jsonb_build_object('ok', false, 'code', 'google_invalid');
  end if;
  if v_token is null or char_length(v_token) < 20 or char_length(v_token) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'google_invalid');
  end if;
  if char_length(v_calendar) > 200 then
    return jsonb_build_object('ok', false, 'code', 'google_invalid');
  end if;

  insert into public.service_google_connections (
    company_id, google_email, refresh_token_enc, calendar_id, status, connected_at, updated_at
  )
  values (p_company_id, v_email, v_token, v_calendar, 'connected', now(), now())
  on conflict (company_id) do update
    set google_email = excluded.google_email,
        refresh_token_enc = excluded.refresh_token_enc,
        calendar_id = excluded.calendar_id,
        status = 'connected',
        connected_at = now(),
        updated_at = now();

  return jsonb_build_object('ok', true, 'code', 'ok', 'email', v_email);
end;
$$;

create or replace function public.rpc_service_google_disconnect(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  delete from public.service_google_connections where company_id = p_company_id;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_service_google_revoke(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  update public.service_google_connections
    set status = 'revoked', updated_at = now()
    where company_id = p_company_id;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_service_google_mark(
  p_company_id uuid,
  p_appointment_id uuid,
  p_event_id text,
  p_sync text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text := nullif(btrim(p_event_id), '');
begin
  if p_sync is distinct from 'synced' and p_sync is distinct from 'failed' then
    return jsonb_build_object('ok', false, 'code', 'google_invalid');
  end if;
  if v_event is not null and char_length(v_event) > 1024 then
    return jsonb_build_object('ok', false, 'code', 'google_invalid');
  end if;

  update public.service_appointments
    set google_event_id = v_event,
        google_sync = p_sync
    where id = p_appointment_id
      and company_id = p_company_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_service_peek_open_slot(
  p_company_id uuid,
  p_thread_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_starts timestamptz;
  v_offering uuid;
  v_duration integer;
  v_name text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  select o.starts_at, o.offering_id, off.duration_min, off.name
    into v_starts, v_offering, v_duration, v_name
  from public.service_slot_offers o
  join public.service_offerings off on off.id = o.offering_id and off.company_id = o.company_id
  where o.company_id = p_company_id
    and o.thread_id = p_thread_id
    and o.consumed_at is null
    and o.superseded_at is null;

  if v_starts is null or v_duration is null then
    return jsonb_build_object('ok', false, 'code', 'offer_expired');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'offering_id', v_offering,
    'offering_name', v_name,
    'starts_at', v_starts,
    'ends_at', v_starts + make_interval(mins => v_duration)
  );
end;
$$;

create or replace function public.rpc_service_slot_window(
  p_company_id uuid,
  p_offering_id uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_duration integer;
  v_name text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  if p_starts_at is null then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;

  select o.duration_min, o.name into v_duration, v_name
  from public.service_offerings o
  where o.id = p_offering_id
    and o.company_id = p_company_id
    and o.active
    and o.duration_min is not null;

  if v_duration is null then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'offering_name', v_name,
    'starts_at', p_starts_at,
    'ends_at', p_starts_at + make_interval(mins => v_duration),
    'duration_min', v_duration
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
    'google_event_id', v_row.google_event_id,
    'status', v_row.status,
    'time_zone', coalesce(v_tz, 'America/Cuiaba')
  );
end;
$$;

create or replace function public.rpc_service_list_free_slots(
  p_company_id uuid,
  p_offering_id uuid,
  p_day date
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
  v_duration integer;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'slots', '[]'::jsonb);
  end if;
  select p.agenda_enabled into v_agenda from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_agenda, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'agenda_off', 'slots', '[]'::jsonb);
  end if;

  select o.duration_min into v_duration
  from public.service_offerings o
  where o.id = p_offering_id
    and o.company_id = p_company_id
    and o.active;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'duration_min', v_duration,
    'slots', coalesce(
      (
        select jsonb_agg(to_jsonb(s.fn_service_free_starts) order by s.fn_service_free_starts)
        from public.fn_service_free_starts(p_company_id, p_offering_id, p_day) s
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.rpc_service_list_company_appointments(p_company_id uuid)
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
  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select a.id, a.offering_name, a.starts_at, a.phone_e164, a.customer_name, a.status, a.google_sync
        from public.service_appointments a
        where a.company_id = p_company_id
          and a.status = 'confirmed'
          and a.starts_at > now()
        order by a.starts_at
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rpc_service_google_status(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_google_secret(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_google_connect(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.rpc_service_google_disconnect(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_google_revoke(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_google_mark(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rpc_service_peek_open_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_slot_window(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_service_appointment_mirror(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_list_free_slots(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.rpc_service_list_company_appointments(uuid) from public, anon, authenticated;

grant execute on function public.rpc_service_google_status(uuid) to service_role;
grant execute on function public.rpc_service_google_secret(uuid) to service_role;
grant execute on function public.rpc_service_google_connect(uuid, text, text, text) to service_role;
grant execute on function public.rpc_service_google_disconnect(uuid) to service_role;
grant execute on function public.rpc_service_google_revoke(uuid) to service_role;
grant execute on function public.rpc_service_google_mark(uuid, uuid, text, text) to service_role;
grant execute on function public.rpc_service_peek_open_slot(uuid, uuid) to service_role;
grant execute on function public.rpc_service_slot_window(uuid, uuid, timestamptz) to service_role;
grant execute on function public.rpc_service_appointment_mirror(uuid, uuid) to service_role;
grant execute on function public.rpc_service_list_free_slots(uuid, uuid, date) to service_role;
grant execute on function public.rpc_service_list_company_appointments(uuid) to service_role;
