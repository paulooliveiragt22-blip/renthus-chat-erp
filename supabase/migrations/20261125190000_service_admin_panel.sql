-- ADR 0018. Painel de serviço: leitura e mutação só por RPC, empresa da sessão.

create or replace function public.rpc_service_admin_snapshot(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_profile public.service_profiles%rowtype;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is null then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', true, 'code', 'ok', 'attendance_mode', 'delivery');
  end if;

  select * into v_profile from public.service_profiles p where p.company_id = p_company_id;
  if v_profile.company_id is null then
    return jsonb_build_object('ok', true, 'code', 'ok', 'attendance_mode', 'service', 'profile', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'attendance_mode', 'service',
    'profile', jsonb_build_object(
      'preset', v_profile.service_preset,
      'context_text', v_profile.context_text,
      'agenda_enabled', v_profile.agenda_enabled,
      'cases_enabled', v_profile.cases_enabled,
      'whatsapp_cancel_enabled', v_profile.whatsapp_cancel_enabled,
      'whatsapp_reschedule_enabled', v_profile.whatsapp_reschedule_enabled
    )
  );
end;
$$;

create or replace function public.rpc_service_save_context(
  p_company_id uuid,
  p_context_text text
)
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
  update public.service_profiles
    set context_text = left(coalesce(p_context_text, ''), 4000),
        updated_at = now()
    where company_id = p_company_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_service_set_channel_flags(
  p_company_id uuid,
  p_cancel boolean,
  p_reschedule boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_agenda boolean;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  select p.agenda_enabled into v_agenda from public.service_profiles p where p.company_id = p_company_id;
  if v_agenda is null then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  if coalesce(v_agenda, false) is not true and (coalesce(p_cancel, false) or coalesce(p_reschedule, false)) then
    return jsonb_build_object('ok', false, 'code', 'flag_off');
  end if;
  update public.service_profiles
    set whatsapp_cancel_enabled = coalesce(p_cancel, false) and v_agenda,
        whatsapp_reschedule_enabled = coalesce(p_reschedule, false) and v_agenda,
        updated_at = now()
    where company_id = p_company_id;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_service_upsert_offering(
  p_company_id uuid,
  p_offering_id uuid,
  p_name text,
  p_description text,
  p_duration_min integer,
  p_price_cents integer,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_name text;
  v_id uuid;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  v_name := left(btrim(coalesce(p_name, '')), 80);
  if char_length(v_name) < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_title');
  end if;
  if p_duration_min is not null and p_duration_min not between 15 and 240 then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;
  if p_price_cents is not null and p_price_cents < 0 then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;

  if p_offering_id is null then
    insert into public.service_offerings (
      company_id, name, description, duration_min, price_cents, active
    )
    values (
      p_company_id, v_name, nullif(p_description, ''), p_duration_min, p_price_cents, coalesce(p_active, true)
    )
    returning id into v_id;
  else
    update public.service_offerings
      set name = v_name,
          description = nullif(p_description, ''),
          duration_min = p_duration_min,
          price_cents = p_price_cents,
          active = coalesce(p_active, active),
          updated_at = now()
      where id = p_offering_id
        and company_id = p_company_id
      returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok', 'offering_id', v_id);
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
        select a.id, a.offering_name, a.starts_at, a.phone_e164, a.customer_name, a.status
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

create or replace function public.rpc_service_list_company_cases(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_cases boolean;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'rows', '[]'::jsonb);
  end if;
  select p.cases_enabled into v_cases from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_cases, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'cases_off', 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(row_to_json(x))
      from (
        select
          c.id,
          c.title,
          c.stage,
          c.phone_e164,
          coalesce(
            (select l.label from public.service_case_stage_labels l
              where l.company_id = p_company_id and l.stage_key = c.stage),
            case c.stage
              when 'aberto' then 'Aberto'
              when 'em_andamento' then 'Em andamento'
              when 'concluido' then 'Concluído'
              else 'Perdido'
            end
          ) as label
        from public.service_cases c
        where c.company_id = p_company_id
        order by c.updated_at desc
        limit 80
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_service_set_stage_label(
  p_company_id uuid,
  p_stage text,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_cases boolean;
  v_label text;
begin
  if p_stage not in ('aberto', 'em_andamento', 'concluido', 'perdido') then
    return jsonb_build_object('ok', false, 'code', 'invalid_stage');
  end if;
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  select p.cases_enabled into v_cases from public.service_profiles p where p.company_id = p_company_id;
  if coalesce(v_cases, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'cases_off');
  end if;
  v_label := left(btrim(coalesce(p_label, '')), 40);
  if char_length(v_label) < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_title');
  end if;
  insert into public.service_case_stage_labels (company_id, stage_key, label)
  values (p_company_id, p_stage, v_label)
  on conflict (company_id, stage_key) do update set label = excluded.label;
  return jsonb_build_object('ok', true, 'code', 'ok', 'stage', p_stage, 'label', v_label);
end;
$$;

create or replace function public.rpc_service_admin_book(
  p_company_id uuid,
  p_idempotency_key text,
  p_offering_id uuid,
  p_starts_at timestamptz,
  p_phone_e164 text,
  p_customer_name text,
  p_case_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.fn_service_insert_appointment(
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
end;
$$;

revoke all on function public.rpc_service_admin_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_save_context(uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_service_set_channel_flags(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.rpc_service_upsert_offering(uuid, uuid, text, text, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.rpc_service_list_company_appointments(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_list_company_cases(uuid) from public, anon, authenticated;
revoke all on function public.rpc_service_set_stage_label(uuid, text, text) from public, anon, authenticated;
revoke all on function public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid) from public, anon, authenticated;

grant execute on function public.rpc_service_admin_snapshot(uuid) to service_role;
grant execute on function public.rpc_service_save_context(uuid, text) to service_role;
grant execute on function public.rpc_service_set_channel_flags(uuid, boolean, boolean) to service_role;
grant execute on function public.rpc_service_upsert_offering(uuid, uuid, text, text, integer, integer, boolean) to service_role;
grant execute on function public.rpc_service_list_company_appointments(uuid) to service_role;
grant execute on function public.rpc_service_list_company_cases(uuid) to service_role;
grant execute on function public.rpc_service_set_stage_label(uuid, text, text) to service_role;
grant execute on function public.rpc_service_admin_book(uuid, text, uuid, timestamptz, text, text, uuid) to service_role;
