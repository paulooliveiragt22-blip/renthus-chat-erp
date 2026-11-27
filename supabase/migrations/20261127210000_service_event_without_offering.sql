-- Evento do painel pode existir sem oferta. A duração vem do painel (15, 30 ou 60).
-- O WhatsApp continua marcando só em cima de uma oferta.

alter table public.service_appointments
  alter column offering_id drop not null;

alter table public.service_appointments
  alter column offering_name drop not null;

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
  p_offer_id uuid,
  p_duration_min integer
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
  v_duration integer;
  v_offering_id uuid;
  v_offering_name text;
  v_price integer;
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

  if p_offering_id is null then
    if p_source is distinct from 'admin' or p_duration_min not in (15, 30, 60) then
      return jsonb_build_object('ok', false, 'code', 'offering_invalid');
    end if;
    v_duration := p_duration_min;
    v_offering_id := null;
    v_offering_name := null;
    v_price := null;
  else
    select * into v_offering
    from public.service_offerings o
    where o.id = p_offering_id
      and o.company_id = p_company_id
      and o.active
      and o.duration_min is not null;
    if v_offering.id is null then
      return jsonb_build_object('ok', false, 'code', 'offering_invalid');
    end if;
    v_duration := v_offering.duration_min;
    v_offering_id := v_offering.id;
    v_offering_name := v_offering.name;
    v_price := v_offering.price_cents;
  end if;

  if p_source = 'whatsapp_button' then
    if p_offer_id is null or p_thread_id is null or p_offering_id is null then
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

  if not public.fn_service_starts_allowed(p_company_id, p_starts_at, v_duration) then
    if exists (
      select 1
      from public.service_profiles p
      where p.company_id = p_company_id
        and jsonb_typeof(p.attendance_windows) = 'array'
        and jsonb_array_length(p.attendance_windows) > 0
    ) or exists (
      select 1
      from public.fn_service_company_clock(p_company_id) c
      where jsonb_typeof(c.periods) = 'array'
        and jsonb_array_length(c.periods) > 0
    ) then
      return jsonb_build_object('ok', false, 'code', 'outside_hours');
    end if;
    return jsonb_build_object('ok', false, 'code', 'no_hours');
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

  v_ends := p_starts_at + make_interval(mins => v_duration);

  begin
    insert into public.service_appointments (
      company_id, offering_id, case_id, customer_id, thread_id,
      phone_e164, customer_name, starts_at, ends_at,
      status, offering_name, price_cents, source, idempotency_key
    )
    values (
      p_company_id, v_offering_id, p_case_id, p_customer_id, p_thread_id,
      v_phone, nullif(btrim(p_customer_name), ''), p_starts_at, v_ends,
      'confirmed', v_offering_name, v_price, p_source, p_idempotency_key
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
    'offering_name', v_offering_name,
    'price_cents', v_price
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
begin
  return public.fn_service_insert_appointment(
    p_company_id,
    p_source,
    p_idempotency_key,
    p_offering_id,
    p_starts_at,
    p_phone_e164,
    p_customer_name,
    p_thread_id,
    p_customer_id,
    p_case_id,
    p_offer_id,
    null
  );
end;
$$;

drop function if exists public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid, text);

create or replace function public.rpc_service_admin_book(
  p_company_id uuid,
  p_idempotency_key text,
  p_offering_id uuid,
  p_starts_at timestamptz,
  p_phone_e164 text,
  p_customer_name text,
  p_case_id uuid,
  p_label text,
  p_duration_min integer
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
    null,
    p_duration_min
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

revoke all on function public.fn_service_insert_appointment(uuid, text, text, uuid, timestamptz, text, text, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.fn_service_insert_appointment(uuid, text, text, uuid, timestamptz, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid, text, integer) from public, anon, authenticated;

grant execute on function public.fn_service_insert_appointment(uuid, text, text, uuid, timestamptz, text, text, uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.fn_service_insert_appointment(uuid, text, text, uuid, timestamptz, text, text, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid, text, integer) to service_role;
