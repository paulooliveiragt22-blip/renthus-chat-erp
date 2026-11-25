-- ADR 0018. O card novo também espera botão. A proposta fica numa linha, como a vaga.

create table if not exists public.service_case_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  thread_id uuid not null references public.whatsapp_threads (id) on delete cascade,
  title text not null,
  summary text not null default '',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  superseded_at timestamptz,
  case_id uuid references public.service_cases (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint service_case_offers_title_len check (char_length(btrim(title)) between 1 and 80),
  constraint service_case_offers_summary_len check (char_length(summary) <= 500)
);

create unique index if not exists service_case_offers_one_open_per_thread
  on public.service_case_offers (thread_id)
  where consumed_at is null and superseded_at is null;

create index if not exists service_case_offers_company_idx
  on public.service_case_offers (company_id);

alter table public.service_case_offers enable row level security;
alter table public.service_case_offers force row level security;
revoke all on table public.service_case_offers from anon, authenticated;

drop policy if exists rls_service_case_offers_service_role_only on public.service_case_offers;
create policy rls_service_case_offers_service_role_only on public.service_case_offers
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant all on table public.service_case_offers to service_role;

create or replace function public.rpc_service_load_profile(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_profile public.service_profiles%rowtype;
  v_tz text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  select * into v_profile from public.service_profiles p where p.company_id = p_company_id;
  if v_profile.company_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  select c.time_zone into v_tz from public.fn_service_company_clock(p_company_id) c;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'preset', v_profile.service_preset,
    'context_text', v_profile.context_text,
    'agenda_enabled', v_profile.agenda_enabled,
    'cases_enabled', v_profile.cases_enabled,
    'whatsapp_cancel_enabled', v_profile.whatsapp_cancel_enabled,
    'whatsapp_reschedule_enabled', v_profile.whatsapp_reschedule_enabled,
    'time_zone', coalesce(v_tz, 'America/Cuiaba'),
    'labels', jsonb_build_object(
      'aberto', coalesce((select l.label from public.service_case_stage_labels l where l.company_id = p_company_id and l.stage_key = 'aberto'), 'Aberto'),
      'em_andamento', coalesce((select l.label from public.service_case_stage_labels l where l.company_id = p_company_id and l.stage_key = 'em_andamento'), 'Em andamento'),
      'concluido', coalesce((select l.label from public.service_case_stage_labels l where l.company_id = p_company_id and l.stage_key = 'concluido'), 'Concluído'),
      'perdido', coalesce((select l.label from public.service_case_stage_labels l where l.company_id = p_company_id and l.stage_key = 'perdido'), 'Perdido')
    )
  );
end;
$$;

create or replace function public.rpc_service_list_offerings(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'description', o.description,
        'duration_min', o.duration_min,
        'price_cents', o.price_cents
      ) order by o.name)
      from public.service_offerings o
      where o.company_id = p_company_id
        and o.active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_service_list_thread_appointments(
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
  v_company uuid;
  v_phone text;
begin
  select t.company_id, t.phone_e164 into v_company, v_phone
  from public.whatsapp_threads t
  where t.id = p_thread_id;
  if v_company is distinct from p_company_id or v_phone is null then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant', 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'offering_name', a.offering_name,
        'starts_at', a.starts_at
      ) order by a.starts_at)
      from public.service_appointments a
      where a.company_id = p_company_id
        and a.phone_e164 = v_phone
        and a.status = 'confirmed'
        and a.starts_at > now()
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_service_list_thread_cases(
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
  v_company uuid;
  v_phone text;
begin
  select t.company_id, t.phone_e164 into v_company, v_phone
  from public.whatsapp_threads t
  where t.id = p_thread_id;
  if v_company is distinct from p_company_id or v_phone is null then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant', 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'stage', c.stage,
        'label', coalesce(
          (select l.label from public.service_case_stage_labels l
            where l.company_id = p_company_id and l.stage_key = c.stage),
          case c.stage
            when 'aberto' then 'Aberto'
            when 'em_andamento' then 'Em andamento'
            when 'concluido' then 'Concluído'
            else 'Perdido'
          end
        )
      ) order by c.created_at)
      from public.service_cases c
      where c.company_id = p_company_id
        and c.phone_e164 = v_phone
        and c.stage in ('aberto', 'em_andamento')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_service_propose_case(
  p_company_id uuid,
  p_thread_id uuid,
  p_title text,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_cases boolean;
  v_thread_company uuid;
  v_title text;
  v_summary text;
  v_id uuid;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  select p.cases_enabled into v_cases from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_cases, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'cases_off');
  end if;

  select t.company_id into v_thread_company
  from public.whatsapp_threads t
  where t.id = p_thread_id;
  if v_thread_company is distinct from p_company_id then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  v_title := left(btrim(coalesce(p_title, '')), 80);
  v_summary := left(coalesce(p_summary, ''), 500);
  if char_length(v_title) < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_title');
  end if;

  update public.service_case_offers
    set superseded_at = now()
    where thread_id = p_thread_id
      and consumed_at is null
      and superseded_at is null;

  insert into public.service_case_offers (
    company_id, thread_id, title, summary, expires_at
  )
  values (
    p_company_id, p_thread_id, v_title, v_summary, now() + interval '15 minutes'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'ok', 'offer_id', v_id, 'title', v_title);
end;
$$;

create or replace function public.rpc_service_confirm_open_slot(
  p_company_id uuid,
  p_thread_id uuid,
  p_idempotency_key text,
  p_customer_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.service_slot_offers%rowtype;
  v_thread_company uuid;
  v_inserted jsonb;
  v_tz text;
begin
  select t.company_id into v_thread_company
  from public.whatsapp_threads t
  where t.id = p_thread_id;
  if v_thread_company is distinct from p_company_id then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  select * into v_offer
  from public.service_slot_offers
  where thread_id = p_thread_id
    and company_id = p_company_id
    and consumed_at is null
    and superseded_at is null
  for update;

  if v_offer.id is null then
    return jsonb_build_object('ok', false, 'code', 'offer_expired');
  end if;

  v_inserted := public.fn_service_insert_appointment(
    p_company_id,
    'whatsapp_button',
    p_idempotency_key,
    v_offer.offering_id,
    v_offer.starts_at,
    null,
    p_customer_name,
    p_thread_id,
    null,
    null,
    v_offer.id
  );

  if coalesce((v_inserted->>'ok')::boolean, false) is not true then
    return v_inserted;
  end if;

  select c.time_zone into v_tz from public.fn_service_company_clock(p_company_id) c;
  return v_inserted || jsonb_build_object('time_zone', coalesce(v_tz, 'America/Cuiaba'));
end;
$$;

create or replace function public.rpc_service_confirm_open_case(
  p_company_id uuid,
  p_thread_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.service_case_offers%rowtype;
  v_thread_company uuid;
  v_opened jsonb;
begin
  select t.company_id into v_thread_company
  from public.whatsapp_threads t
  where t.id = p_thread_id;
  if v_thread_company is distinct from p_company_id then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;

  select * into v_offer
  from public.service_case_offers
  where thread_id = p_thread_id
    and company_id = p_company_id
    and consumed_at is null
    and superseded_at is null
  for update;

  if v_offer.id is null or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'offer_expired');
  end if;

  v_opened := public.rpc_service_open_case(
    p_company_id,
    'whatsapp_button',
    p_idempotency_key,
    null,
    v_offer.title,
    v_offer.summary,
    p_thread_id,
    null
  );

  if coalesce((v_opened->>'ok')::boolean, false) is not true then
    return v_opened;
  end if;

  update public.service_case_offers
    set consumed_at = now(),
        case_id = (v_opened->>'case_id')::uuid
    where id = v_offer.id;

  return v_opened || jsonb_build_object('title', v_offer.title);
end;
$$;

revoke all on function public.rpc_service_load_profile(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_list_offerings(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_list_thread_appointments(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_list_thread_cases(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_propose_case(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rpc_service_confirm_open_slot(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.rpc_service_confirm_open_case(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.rpc_service_load_profile(uuid) to service_role;
grant execute on function public.rpc_service_list_offerings(uuid) to service_role;
grant execute on function public.rpc_service_list_thread_appointments(uuid, uuid) to service_role;
grant execute on function public.rpc_service_list_thread_cases(uuid, uuid) to service_role;
grant execute on function public.rpc_service_propose_case(uuid, uuid, text, text) to service_role;
grant execute on function public.rpc_service_confirm_open_slot(uuid, uuid, text, text) to service_role;
grant execute on function public.rpc_service_confirm_open_case(uuid, uuid, text) to service_role;
