-- ADR 0018 D6. O lembrete nasce na marcação, na outbox que já existe.
-- Sem template UTILITY aprovado, sem thread ou com mais de dois placeholders, a marcação fica e o job não nasce.

create or replace function public.fn_service_enqueue_appointment_reminder()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_periods jsonb;
  v_open integer;
  v_candidate integer;
  v_period record;
  v_eve date;
  v_scheduled timestamptz;
  v_thread uuid;
  v_name text;
  v_language text;
  v_components jsonb;
  v_body text;
  v_slots integer;
  v_who text;
  v_when text;
  v_params jsonb;
begin
  if new.status is distinct from 'confirmed' then
    return new;
  end if;

  select t.name, t.language, t.components
    into v_name, v_language, v_components
  from public.whatsapp_message_templates t
  where t.company_id = new.company_id
    and t.category = 'UTILITY'
    and t.status = 'APPROVED'
  order by t.updated_at desc, t.id desc
  limit 1;

  if v_name is null or v_language is null then
    return new;
  end if;

  v_body := coalesce((
    select c->>'text'
    from jsonb_array_elements(coalesce(v_components, '[]'::jsonb)) c
    where lower(coalesce(c->>'type', '')) = 'body'
    limit 1
  ), '');
  select count(*)::int into v_slots
  from regexp_matches(v_body, '\{\{[0-9]+\}\}', 'g');
  if coalesce(v_slots, 0) > 2 then
    return new;
  end if;

  v_thread := new.thread_id;
  if v_thread is null then
    select t.id into v_thread
    from public.whatsapp_threads t
    where t.company_id = new.company_id
      and t.phone_e164 = new.phone_e164
      and coalesce(t.channel, 'whatsapp') = 'whatsapp'
    order by t.last_message_at desc nulls last
    limit 1;
  else
    perform 1
    from public.whatsapp_threads t
    where t.id = v_thread
      and t.company_id = new.company_id;
    if not found then
      v_thread := null;
    end if;
  end if;
  if v_thread is null then
    return new;
  end if;

  select c.time_zone, c.periods into v_tz, v_periods
  from public.fn_service_company_clock(new.company_id) c;
  v_open := null;
  if jsonb_typeof(v_periods) = 'array' then
    for v_period in select e from jsonb_array_elements(v_periods) as t(e)
    loop
      v_candidate := public.fn_service_hhmm_minutes(coalesce(v_period.e->>'open', v_period.e->>'openTime'));
      if v_candidate is not null and (v_open is null or v_candidate < v_open) then
        v_open := v_candidate;
      end if;
    end loop;
  end if;
  if v_open is null then
    return new;
  end if;

  v_eve := ((new.starts_at at time zone v_tz)::date - 1);
  v_scheduled := ((v_eve::timestamp + make_interval(mins => v_open)) at time zone v_tz);
  v_who := coalesce(nullif(btrim(new.customer_name), ''), new.offering_name, 'cliente');
  v_when := to_char(new.starts_at at time zone v_tz, 'DD/MM HH24:MI');
  v_params := case
    when coalesce(v_slots, 0) = 0 then '[]'::jsonb
    when v_slots = 1 then jsonb_build_array(v_when)
    else jsonb_build_array(v_who, v_when)
  end;

  insert into public.outbound_jobs (
    company_id, thread_id, phone_e164, purpose, payload, dedup_key, source_id, scheduled_at, status
  )
  values (
    new.company_id,
    v_thread,
    new.phone_e164,
    'appointment_reminder',
    jsonb_build_object(
      'kind', 'template',
      'text', 'Lembrete: ' || coalesce(new.offering_name, 'horário') || ' em ' || v_when,
      'templateName', v_name,
      'language', v_language,
      'bodyParams', v_params
    ),
    'appointment_reminder:' || new.id::text,
    new.id,
    v_scheduled,
    'pending'
  )
  on conflict (company_id, dedup_key) do nothing;

  return new;
exception
  when others then
    raise warning 'appointment_reminder_enqueue: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_service_appointment_reminder on public.service_appointments;

create trigger trg_service_appointment_reminder
after insert on public.service_appointments
for each row
when (new.status = 'confirmed')
execute function public.fn_service_enqueue_appointment_reminder();

revoke all on function public.fn_service_enqueue_appointment_reminder() from public, anon, authenticated;
grant execute on function public.fn_service_enqueue_appointment_reminder() to service_role;

create index if not exists outbound_jobs_appointment_reminder_idx
  on public.outbound_jobs (company_id, source_id)
  where purpose = 'appointment_reminder';

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

  update public.outbound_jobs
    set status = 'skipped',
        skip_reason = 'appointment_cancelled'
    where company_id = p_company_id
      and source_id = v_row.id
      and purpose = 'appointment_reminder'
      and status in ('pending', 'processing');

  return jsonb_build_object('ok', true, 'code', 'ok', 'appointment_id', v_row.id);
end;
$$;

revoke all on function public.rpc_service_cancel_appointment(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.rpc_service_cancel_appointment(uuid, uuid, text, uuid) to service_role;
