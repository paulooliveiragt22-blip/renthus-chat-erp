-- ADR 0018. Modo serviço: perfil, oferta, vaga, card e horário.
-- A grade e a inserção moram aqui. O app não grava essas tabelas direto.

alter table public.companies
  add column if not exists attendance_mode text not null default 'delivery';

alter table public.companies
  drop constraint if exists companies_attendance_mode_check;

alter table public.companies
  add constraint companies_attendance_mode_check
  check (attendance_mode = any (array['delivery'::text, 'service'::text]));

comment on column public.companies.attendance_mode is
  'ADR 0018. delivery segue src/pro. service segue src/service.';

-- Lembrete ainda não enfileira. O CHECK já aceita o purpose para não precisar de outra migration.
alter table public.outbound_jobs
  drop constraint if exists outbound_jobs_purpose_check;

alter table public.outbound_jobs
  add constraint outbound_jobs_purpose_check
  check (
    purpose = any (array[
      'cart_recovery'::text,
      'reengagement'::text,
      'promo'::text,
      'transactional'::text,
      'broadcast_template'::text,
      'appointment_reminder'::text
    ])
  );

create table if not exists public.service_profiles (
  company_id uuid primary key references public.companies (id) on delete cascade,
  context_text text not null default '',
  service_preset text not null,
  agenda_enabled boolean not null,
  cases_enabled boolean not null,
  whatsapp_cancel_enabled boolean not null default false,
  whatsapp_reschedule_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_profiles_preset_check check (
    service_preset = any (array['horario'::text, 'servico'::text, 'consulta_caso'::text, 'balcao'::text])
  ),
  constraint service_profiles_context_len check (char_length(context_text) <= 4000),
  constraint service_profiles_flags_match_preset check (
    (service_preset = 'horario' and agenda_enabled and not cases_enabled)
    or (service_preset in ('servico', 'consulta_caso') and agenda_enabled and cases_enabled)
    or (service_preset = 'balcao' and not agenda_enabled and not cases_enabled)
  ),
  constraint service_profiles_cancel_needs_agenda check (
    not whatsapp_cancel_enabled or agenda_enabled
  ),
  constraint service_profiles_reschedule_needs_agenda check (
    not whatsapp_reschedule_enabled or agenda_enabled
  )
);

create table if not exists public.service_offerings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text,
  duration_min integer,
  price_cents integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_offerings_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint service_offerings_description_len check (
    description is null or char_length(description) <= 500
  ),
  constraint service_offerings_duration_check check (
    duration_min is null or duration_min between 15 and 240
  ),
  constraint service_offerings_price_check check (
    price_cents is null or price_cents >= 0
  )
);

create index if not exists service_offerings_company_idx
  on public.service_offerings (company_id);

create table if not exists public.service_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  thread_id uuid references public.whatsapp_threads (id) on delete set null,
  phone_e164 text not null,
  title text not null,
  summary text not null default '',
  stage text not null default 'aberto',
  source text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_cases_stage_check check (
    stage = any (array['aberto'::text, 'em_andamento'::text, 'concluido'::text, 'perdido'::text])
  ),
  constraint service_cases_source_check check (
    source = any (array['whatsapp_button'::text, 'admin'::text])
  ),
  constraint service_cases_title_len check (char_length(btrim(title)) between 1 and 80),
  constraint service_cases_summary_len check (char_length(summary) <= 500),
  constraint service_cases_idempotency_len check (char_length(idempotency_key) between 8 and 200),
  constraint service_cases_company_idempotency_uq unique (company_id, idempotency_key)
);

create index if not exists service_cases_company_phone_stage_idx
  on public.service_cases (company_id, phone_e164, stage);

create table if not exists public.service_case_stage_labels (
  company_id uuid not null references public.companies (id) on delete cascade,
  stage_key text not null,
  label text not null,
  constraint service_case_stage_labels_pkey primary key (company_id, stage_key),
  constraint service_case_stage_labels_key_check check (
    stage_key = any (array['aberto'::text, 'em_andamento'::text, 'concluido'::text, 'perdido'::text])
  ),
  constraint service_case_stage_labels_label_len check (char_length(btrim(label)) between 1 and 40)
);

create table if not exists public.service_appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  offering_id uuid not null references public.service_offerings (id) on delete restrict,
  case_id uuid references public.service_cases (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  thread_id uuid references public.whatsapp_threads (id) on delete set null,
  phone_e164 text not null,
  customer_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  during tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status text not null default 'confirmed',
  offering_name text not null,
  price_cents integer,
  source text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint service_appointments_status_check check (
    status = any (array['confirmed'::text, 'cancelled'::text])
  ),
  constraint service_appointments_source_check check (
    source = any (array['whatsapp_button'::text, 'admin'::text])
  ),
  constraint service_appointments_ends_after check (ends_at > starts_at),
  constraint service_appointments_price_check check (price_cents is null or price_cents >= 0),
  constraint service_appointments_idempotency_len check (char_length(idempotency_key) between 8 and 200),
  constraint service_appointments_company_idempotency_uq unique (company_id, idempotency_key)
);

create index if not exists service_appointments_company_starts_confirmed_idx
  on public.service_appointments (company_id, starts_at)
  where status = 'confirmed';

create index if not exists service_appointments_company_phone_starts_idx
  on public.service_appointments (company_id, phone_e164, starts_at);

alter table public.service_appointments
  drop constraint if exists service_appointments_no_overlap;

alter table public.service_appointments
  add constraint service_appointments_no_overlap
  exclude using gist (company_id with =, during with &&)
  where (status = 'confirmed');

create table if not exists public.service_slot_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  thread_id uuid not null references public.whatsapp_threads (id) on delete cascade,
  offering_id uuid not null references public.service_offerings (id) on delete cascade,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  superseded_at timestamptz,
  appointment_id uuid references public.service_appointments (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists service_slot_offers_one_open_per_thread
  on public.service_slot_offers (thread_id)
  where consumed_at is null and superseded_at is null;

create index if not exists service_slot_offers_company_idx
  on public.service_slot_offers (company_id);

comment on column public.service_slot_offers.superseded_at is
  'ADR 0018. Nova proposta encerra a anterior sem consumir. O índice único não aceita now() no predicado.';

-- RLS
alter table public.service_profiles enable row level security;
alter table public.service_profiles force row level security;
alter table public.service_offerings enable row level security;
alter table public.service_offerings force row level security;
alter table public.service_cases enable row level security;
alter table public.service_cases force row level security;
alter table public.service_case_stage_labels enable row level security;
alter table public.service_case_stage_labels force row level security;
alter table public.service_appointments enable row level security;
alter table public.service_appointments force row level security;
alter table public.service_slot_offers enable row level security;
alter table public.service_slot_offers force row level security;

revoke all on table public.service_profiles from anon, authenticated;
revoke all on table public.service_offerings from anon, authenticated;
revoke all on table public.service_cases from anon, authenticated;
revoke all on table public.service_case_stage_labels from anon, authenticated;
revoke all on table public.service_appointments from anon, authenticated;
revoke all on table public.service_slot_offers from anon, authenticated;

drop policy if exists rls_service_profiles_service_role_only on public.service_profiles;
create policy rls_service_profiles_service_role_only on public.service_profiles
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists rls_service_offerings_service_role_only on public.service_offerings;
create policy rls_service_offerings_service_role_only on public.service_offerings
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists rls_service_cases_service_role_only on public.service_cases;
create policy rls_service_cases_service_role_only on public.service_cases
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists rls_service_case_stage_labels_service_role_only on public.service_case_stage_labels;
create policy rls_service_case_stage_labels_service_role_only on public.service_case_stage_labels
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists rls_service_appointments_service_role_only on public.service_appointments;
create policy rls_service_appointments_service_role_only on public.service_appointments
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists rls_service_slot_offers_service_role_only on public.service_slot_offers;
create policy rls_service_slot_offers_service_role_only on public.service_slot_offers
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant all on table public.service_profiles to service_role;
grant all on table public.service_offerings to service_role;
grant all on table public.service_cases to service_role;
grant all on table public.service_case_stage_labels to service_role;
grant all on table public.service_appointments to service_role;
grant all on table public.service_slot_offers to service_role;

-- Grade. Mesma regra de turno que cruza a meia-noite: close < open.
create or replace function public.fn_service_hhmm_minutes(p_hhmm text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_hhmm ~ '^\d{2}:\d{2}$'
      and split_part(p_hhmm, ':', 1)::int between 0 and 23
      and split_part(p_hhmm, ':', 2)::int between 0 and 59
    then split_part(p_hhmm, ':', 1)::int * 60 + split_part(p_hhmm, ':', 2)::int
    else null
  end;
$$;

create or replace function public.fn_service_slot_fits(
  p_start_min integer,
  p_duration integer,
  p_open integer,
  p_close integer
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_open is null or p_close is null or p_duration is null or p_start_min is null then false
    when p_duration < 15 then false
    when p_open = p_close then
      p_start_min % p_duration = 0 and p_start_min + p_duration <= 1440
    when p_close > p_open then
      p_start_min >= p_open
      and p_start_min + p_duration <= p_close
      and (p_start_min - p_open) % p_duration = 0
    else
      (
        p_start_min >= p_open
        and p_start_min + p_duration <= 1440
        and (p_start_min - p_open) % p_duration = 0
      )
      or (
        p_start_min < p_close
        and p_start_min + p_duration <= p_close
        and p_start_min % p_duration = 0
      )
  end;
$$;

create or replace function public.fn_service_company_clock(p_company_id uuid)
returns table (time_zone text, periods jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(nullif(btrim(cs.timezone), ''), 'America/Cuiaba'),
    coalesce(cs.opening_periods, '[]'::jsonb)
  from public.company_settings cs
  where cs.company_id = p_company_id;
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
  select c.time_zone, c.periods into v_tz, v_periods
  from public.fn_service_company_clock(p_company_id) c;
  if v_periods is null or jsonb_typeof(v_periods) <> 'array' or jsonb_array_length(v_periods) = 0 then
    return false;
  end if;
  v_local := p_starts_at at time zone v_tz;
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

  select c.time_zone, c.periods into v_tz, v_periods
  from public.fn_service_company_clock(p_company_id) c;
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
      v_slot := (p_day::timestamp + make_interval(mins => v_min)) at time zone v_tz;
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
        v_slot := (p_day::timestamp + make_interval(mins => v_min)) at time zone v_tz;
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
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'slots', '[]'::jsonb);
  end if;
  select p.agenda_enabled into v_agenda from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_agenda, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'agenda_off', 'slots', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
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

create or replace function public.rpc_service_apply_preset(
  p_company_id uuid,
  p_preset text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agenda boolean;
  v_cases boolean;
begin
  if p_preset not in ('horario', 'servico', 'consulta_caso', 'balcao') then
    return jsonb_build_object('ok', false, 'code', 'invalid_preset');
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  v_agenda := p_preset <> 'balcao';
  v_cases := p_preset in ('servico', 'consulta_caso');

  update public.companies
    set attendance_mode = 'service'
    where id = p_company_id;

  insert into public.service_profiles (
    company_id, service_preset, agenda_enabled, cases_enabled
  )
  values (p_company_id, p_preset, v_agenda, v_cases)
  on conflict (company_id) do update
    set service_preset = excluded.service_preset,
        agenda_enabled = excluded.agenda_enabled,
        cases_enabled = excluded.cases_enabled,
        whatsapp_cancel_enabled = service_profiles.whatsapp_cancel_enabled and excluded.agenda_enabled,
        whatsapp_reschedule_enabled = service_profiles.whatsapp_reschedule_enabled and excluded.agenda_enabled,
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'preset', p_preset,
    'agenda_enabled', v_agenda,
    'cases_enabled', v_cases
  );
end;
$$;

create or replace function public.fn_service_insert_appointment(
  p_company_id uuid,
  p_source text,
  p_idempotency_key text,
  p_offering_id uuid,
  p_starts_at timestamptz,
  p_phone_e164 text,
  p_customer_name text,
  p_thread_id uuid,
  p_customer_id uuid,
  p_case_id uuid,
  p_offer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
  v_mode text;
  v_agenda boolean;
  v_offering public.service_offerings%rowtype;
  v_offer public.service_slot_offers%rowtype;
  v_thread_phone text;
  v_thread_company uuid;
  v_case public.service_cases%rowtype;
  v_customer_company uuid;
  v_phone text;
  v_ends timestamptz;
  v_id uuid;
  v_future integer;
begin
  if p_source not in ('whatsapp_button', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency');
  end if;

  select a.id into v_existing
  from public.service_appointments a
  where a.company_id = p_company_id
    and a.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'code', 'idempotent_replay', 'appointment_id', v_existing);
  end if;

  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  select p.agenda_enabled into v_agenda from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_agenda, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'agenda_off');
  end if;

  select * into v_offering
  from public.service_offerings o
  where o.id = p_offering_id
    and o.company_id = p_company_id
    and o.active
    and o.duration_min is not null;
  if v_offering.id is null then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;

  if p_source = 'whatsapp_button' then
    if p_offer_id is null or p_thread_id is null then
      return jsonb_build_object('ok', false, 'code', 'offer_expired');
    end if;
    select * into v_offer
    from public.service_slot_offers
    where id = p_offer_id
    for update;
    if v_offer.id is null or v_offer.company_id <> p_company_id or v_offer.thread_id <> p_thread_id then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
    if v_offer.consumed_at is not null or v_offer.superseded_at is not null or v_offer.expires_at <= now() then
      return jsonb_build_object('ok', false, 'code', 'offer_expired');
    end if;
    if v_offer.offering_id <> p_offering_id or v_offer.starts_at <> p_starts_at then
      return jsonb_build_object('ok', false, 'code', 'offer_expired');
    end if;
  end if;

  if p_thread_id is not null then
    select t.company_id, t.phone_e164 into v_thread_company, v_thread_phone
    from public.whatsapp_threads t
    where t.id = p_thread_id;
    if v_thread_company is distinct from p_company_id then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
  end if;

  if p_source = 'whatsapp_button' then
    v_phone := nullif(btrim(v_thread_phone), '');
    if v_phone is null then
      return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
    end if;
    if p_phone_e164 is not null and btrim(p_phone_e164) <> v_phone then
      return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
    end if;
  else
    v_phone := nullif(btrim(p_phone_e164), '');
    if v_phone is null then
      return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
    end if;
    if v_thread_phone is not null and btrim(v_thread_phone) <> v_phone then
      return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
    end if;
  end if;

  if p_customer_id is not null then
    select cu.company_id into v_customer_company
    from public.customers cu
    where cu.id = p_customer_id;
    if v_customer_company is distinct from p_company_id then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
  end if;

  if p_case_id is not null then
    select * into v_case from public.service_cases where id = p_case_id;
    if v_case.id is null
      or v_case.company_id <> p_company_id
      or v_case.phone_e164 <> v_phone
      or v_case.stage not in ('aberto', 'em_andamento')
    then
      return jsonb_build_object('ok', false, 'code', 'case_invalid');
    end if;
  end if;

  if not public.fn_service_starts_allowed(p_company_id, p_starts_at, v_offering.duration_min) then
    if not exists (
      select 1 from public.fn_service_company_clock(p_company_id) c
      where jsonb_typeof(c.periods) = 'array' and jsonb_array_length(c.periods) > 0
    ) then
      return jsonb_build_object('ok', false, 'code', 'no_hours');
    end if;
    return jsonb_build_object('ok', false, 'code', 'outside_hours');
  end if;

  select count(*) into v_future
  from public.service_appointments a
  where a.company_id = p_company_id
    and a.phone_e164 = v_phone
    and a.status = 'confirmed'
    and a.starts_at > now();
  if v_future >= 5 then
    return jsonb_build_object('ok', false, 'code', 'cap_reached');
  end if;

  v_ends := p_starts_at + make_interval(mins => v_offering.duration_min);

  begin
    insert into public.service_appointments (
      company_id, offering_id, case_id, customer_id, thread_id,
      phone_e164, customer_name, starts_at, ends_at,
      status, offering_name, price_cents, source, idempotency_key
    )
    values (
      p_company_id, v_offering.id, p_case_id, p_customer_id, p_thread_id,
      v_phone, nullif(btrim(p_customer_name), ''), p_starts_at, v_ends,
      'confirmed', v_offering.name, v_offering.price_cents, p_source, p_idempotency_key
    )
    returning id into v_id;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'code', 'slot_taken');
    when unique_violation then
      select a.id into v_existing
      from public.service_appointments a
      where a.company_id = p_company_id
        and a.idempotency_key = p_idempotency_key;
      if v_existing is not null then
        return jsonb_build_object('ok', true, 'code', 'idempotent_replay', 'appointment_id', v_existing);
      end if;
      return jsonb_build_object('ok', false, 'code', 'slot_taken');
  end;

  if p_source = 'whatsapp_button' then
    update public.service_slot_offers
      set consumed_at = now(), appointment_id = v_id
      where id = p_offer_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'appointment_id', v_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends,
    'offering_name', v_offering.name,
    'price_cents', v_offering.price_cents
  );
end;
$$;

revoke all on function public.fn_service_hhmm_minutes(text) from public, anon, authenticated;
revoke all on function public.fn_service_slot_fits(integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.fn_service_company_clock(uuid) from public, anon, authenticated;
revoke all on function public.fn_service_starts_allowed(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.fn_service_free_starts(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.rpc_service_list_free_slots(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.rpc_service_apply_preset(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_service_insert_appointment(uuid, text, text, uuid, timestamptz, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.fn_service_hhmm_minutes(text) to service_role;
grant execute on function public.fn_service_slot_fits(integer, integer, integer, integer) to service_role;
grant execute on function public.fn_service_company_clock(uuid) to service_role;
grant execute on function public.fn_service_starts_allowed(uuid, timestamptz, integer) to service_role;
grant execute on function public.fn_service_free_starts(uuid, uuid, date) to service_role;
grant execute on function public.rpc_service_list_free_slots(uuid, uuid, date) to service_role;
grant execute on function public.rpc_service_apply_preset(uuid, text) to service_role;
grant execute on function public.fn_service_insert_appointment(uuid, text, text, uuid, timestamptz, text, text, uuid, uuid, uuid, uuid) to service_role;

create or replace function public.rpc_service_propose_slot(
  p_company_id uuid,
  p_thread_id uuid,
  p_offering_id uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration integer;
  v_thread_company uuid;
  v_id uuid;
  v_mode text;
  v_agenda boolean;
  v_day date;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  select p.agenda_enabled into v_agenda from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_agenda, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'agenda_off');
  end if;

  select t.company_id into v_thread_company
  from public.whatsapp_threads t
  where t.id = p_thread_id;
  if v_thread_company is distinct from p_company_id then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  select o.duration_min into v_duration
  from public.service_offerings o
  where o.id = p_offering_id
    and o.company_id = p_company_id
    and o.active
    and o.duration_min is not null;
  if v_duration is null then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;

  v_day := (p_starts_at at time zone (
    select c.time_zone from public.fn_service_company_clock(p_company_id) c
  ))::date;

  if not exists (
    select 1
    from public.fn_service_free_starts(p_company_id, p_offering_id, v_day) s
    where s.fn_service_free_starts = p_starts_at
  ) then
    return jsonb_build_object('ok', false, 'code', 'outside_hours');
  end if;

  update public.service_slot_offers
    set superseded_at = now()
    where thread_id = p_thread_id
      and consumed_at is null
      and superseded_at is null;

  insert into public.service_slot_offers (
    company_id, thread_id, offering_id, starts_at, expires_at
  )
  values (
    p_company_id, p_thread_id, p_offering_id, p_starts_at, now() + interval '15 minutes'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'ok', 'offer_id', v_id, 'expires_at', now() + interval '15 minutes');
end;
$$;

create or replace function public.rpc_service_cancel_appointment(
  p_company_id uuid,
  p_appointment_id uuid,
  p_actor text,
  p_thread_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.service_appointments%rowtype;
  v_cancel boolean;
  v_thread_phone text;
  v_thread_company uuid;
begin
  if p_actor not in ('whatsapp', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source');
  end if;

  select * into v_row
  from public.service_appointments
  where id = p_appointment_id
  for update;

  if v_row.id is null or v_row.company_id <> p_company_id then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;
  if v_row.status <> 'confirmed' or v_row.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'appointment_closed');
  end if;

  if p_actor = 'whatsapp' then
    select p.whatsapp_cancel_enabled into v_cancel
    from public.service_profiles p
    where p.company_id = p_company_id;
    if coalesce(v_cancel, false) is not true then
      return jsonb_build_object('ok', false, 'code', 'flag_off');
    end if;
    select t.company_id, t.phone_e164 into v_thread_company, v_thread_phone
    from public.whatsapp_threads t
    where t.id = p_thread_id;
    if v_thread_company is distinct from p_company_id or v_thread_phone is distinct from v_row.phone_e164 then
      return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
    end if;
  end if;

  update public.service_appointments
    set status = 'cancelled'
    where id = v_row.id;

  return jsonb_build_object('ok', true, 'code', 'ok', 'appointment_id', v_row.id);
end;
$$;

create or replace function public.rpc_service_reschedule_appointment(
  p_company_id uuid,
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_idempotency_key text,
  p_actor text,
  p_thread_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.service_appointments%rowtype;
  v_flag boolean;
  v_thread_phone text;
  v_thread_company uuid;
  v_cancel jsonb;
  v_inserted jsonb;
begin
  if p_actor not in ('whatsapp', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source');
  end if;

  select * into v_row
  from public.service_appointments
  where id = p_appointment_id
  for update;

  if v_row.id is null or v_row.company_id <> p_company_id then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  if p_actor = 'whatsapp' then
    select p.whatsapp_reschedule_enabled into v_flag
    from public.service_profiles p
    where p.company_id = p_company_id;
    if coalesce(v_flag, false) is not true then
      return jsonb_build_object('ok', false, 'code', 'flag_off');
    end if;
    select t.company_id, t.phone_e164 into v_thread_company, v_thread_phone
    from public.whatsapp_threads t
    where t.id = p_thread_id;
    if v_thread_company is distinct from p_company_id or v_thread_phone is distinct from v_row.phone_e164 then
      return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
    end if;
  end if;

  if not exists (
    select 1
    from public.fn_service_free_starts(
      p_company_id,
      v_row.offering_id,
      (p_starts_at at time zone (select c.time_zone from public.fn_service_company_clock(p_company_id) c))::date
    ) s
    where s.fn_service_free_starts = p_starts_at
  ) then
    return jsonb_build_object('ok', false, 'code', 'outside_hours');
  end if;

  v_cancel := public.rpc_service_cancel_appointment(
    p_company_id, p_appointment_id, 'admin', null
  );
  if coalesce((v_cancel->>'ok')::boolean, false) is not true then
    return v_cancel;
  end if;

  v_inserted := public.fn_service_insert_appointment(
    p_company_id,
    'admin',
    p_idempotency_key,
    v_row.offering_id,
    p_starts_at,
    v_row.phone_e164,
    v_row.customer_name,
    v_row.thread_id,
    v_row.customer_id,
    v_row.case_id,
    null
  );

  if coalesce((v_inserted->>'ok')::boolean, false) is not true then
    raise exception 'service_reschedule_failed:%', v_inserted->>'code';
  end if;

  if p_actor = 'whatsapp' then
    update public.service_appointments
      set source = 'whatsapp_button'
      where id = (v_inserted->>'appointment_id')::uuid
        and company_id = p_company_id;
  end if;

  return v_inserted;
end;
$$;

create or replace function public.rpc_service_open_case(
  p_company_id uuid,
  p_source text,
  p_idempotency_key text,
  p_phone_e164 text,
  p_title text,
  p_summary text,
  p_thread_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
  v_cases boolean;
  v_mode text;
  v_phone text;
  v_thread_company uuid;
  v_thread_phone text;
  v_customer_company uuid;
  v_open integer;
  v_id uuid;
  v_title text;
  v_summary text;
begin
  if p_source not in ('whatsapp_button', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'invalid_source');
  end if;

  select c.id into v_existing
  from public.service_cases c
  where c.company_id = p_company_id
    and c.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'code', 'idempotent_replay', 'case_id', v_existing);
  end if;

  select co.attendance_mode into v_mode from public.companies co where co.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  select p.cases_enabled into v_cases from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_cases, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'cases_off');
  end if;

  if p_thread_id is not null then
    select t.company_id, t.phone_e164 into v_thread_company, v_thread_phone
    from public.whatsapp_threads t
    where t.id = p_thread_id;
    if v_thread_company is distinct from p_company_id then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
  end if;

  if p_source = 'whatsapp_button' then
    v_phone := nullif(btrim(v_thread_phone), '');
  else
    v_phone := nullif(btrim(p_phone_e164), '');
  end if;
  if v_phone is null then
    return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
  end if;
  if p_source = 'whatsapp_button' and p_phone_e164 is not null and btrim(p_phone_e164) <> v_phone then
    return jsonb_build_object('ok', false, 'code', 'phone_mismatch');
  end if;

  if p_customer_id is not null then
    select cu.company_id into v_customer_company from public.customers cu where cu.id = p_customer_id;
    if v_customer_company is distinct from p_company_id then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
  end if;

  select count(*) into v_open
  from public.service_cases c
  where c.company_id = p_company_id
    and c.phone_e164 = v_phone
    and c.stage in ('aberto', 'em_andamento');
  if v_open >= 4 then
    return jsonb_build_object('ok', false, 'code', 'cap_reached');
  end if;

  v_title := left(btrim(coalesce(p_title, '')), 80);
  v_summary := left(coalesce(p_summary, ''), 500);
  if char_length(v_title) < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_title');
  end if;

  insert into public.service_cases (
    company_id, customer_id, thread_id, phone_e164, title, summary, stage, source, idempotency_key
  )
  values (
    p_company_id, p_customer_id, p_thread_id, v_phone, v_title, v_summary, 'aberto', p_source, p_idempotency_key
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'ok', 'case_id', v_id, 'stage', 'aberto');
end;
$$;

create or replace function public.rpc_service_set_case_stage(
  p_company_id uuid,
  p_case_id uuid,
  p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.service_cases%rowtype;
begin
  if p_stage not in ('aberto', 'em_andamento', 'concluido', 'perdido') then
    return jsonb_build_object('ok', false, 'code', 'invalid_stage');
  end if;
  select * into v_row from public.service_cases where id = p_case_id for update;
  if v_row.id is null or v_row.company_id <> p_company_id then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;
  if v_row.stage in ('concluido', 'perdido') then
    return jsonb_build_object('ok', false, 'code', 'case_closed');
  end if;
  update public.service_cases
    set stage = p_stage, updated_at = now()
    where id = v_row.id;
  return jsonb_build_object('ok', true, 'code', 'ok', 'case_id', v_row.id, 'stage', p_stage);
end;
$$;

revoke all on function public.rpc_service_propose_slot(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_service_cancel_appointment(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_reschedule_appointment(uuid, uuid, timestamptz, text, text, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_open_case(uuid, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_set_case_stage(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.rpc_service_propose_slot(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.rpc_service_cancel_appointment(uuid, uuid, text, uuid) to service_role;
grant execute on function public.rpc_service_reschedule_appointment(uuid, uuid, timestamptz, text, text, uuid) to service_role;
grant execute on function public.rpc_service_open_case(uuid, text, text, text, text, text, uuid, uuid) to service_role;
grant execute on function public.rpc_service_set_case_stage(uuid, uuid, text) to service_role;
