-- Contato deixado no chat do site, para a empresa chamar se a pessoa não abrir o WhatsApp.

alter table public.site_chat_sessions
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_interest text,
  add column if not exists contact_at timestamptz;

alter table public.site_chat_sessions
  drop constraint if exists site_chat_sessions_contact_name_len;
alter table public.site_chat_sessions
  add constraint site_chat_sessions_contact_name_len check (
    contact_name is null or char_length(contact_name) between 2 and 80
  );

alter table public.site_chat_sessions
  drop constraint if exists site_chat_sessions_contact_phone_len;
alter table public.site_chat_sessions
  add constraint site_chat_sessions_contact_phone_len check (
    contact_phone is null or contact_phone ~ '^\+55[0-9]{10,11}$'
  );

alter table public.site_chat_sessions
  drop constraint if exists site_chat_sessions_contact_interest_len;
alter table public.site_chat_sessions
  add constraint site_chat_sessions_contact_interest_len check (
    contact_interest is null or char_length(contact_interest) between 1 and 80
  );

create index if not exists site_chat_sessions_contact_idx
  on public.site_chat_sessions (company_id, contact_at desc)
  where contact_phone is not null;

create or replace function public.rpc_site_chat_save_contact(
  p_company_id uuid,
  p_session_id uuid,
  p_name text,
  p_phone text,
  p_interest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_phone text;
  v_interest text;
  v_id uuid;
begin
  v_name := btrim(coalesce(p_name, ''));
  v_phone := btrim(coalesce(p_phone, ''));
  v_interest := left(btrim(coalesce(p_interest, '')), 80);
  if char_length(v_name) not between 2 and 80
     or v_phone !~ '^\+55[0-9]{10,11}$'
     or char_length(v_interest) < 1 then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;

  update public.site_chat_sessions
    set contact_name = v_name,
        contact_phone = v_phone,
        contact_interest = v_interest,
        contact_at = now()
    where id = p_session_id
      and company_id = p_company_id
      and expires_at > now()
    returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.rpc_site_chat_save_contact(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.rpc_site_chat_save_contact(uuid, uuid, text, text, text) to service_role;

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
  v_contacts jsonb;
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
    return jsonb_build_object('ok', true, 'code', 'ok', 'attendance_mode', 'service', 'profile', null, 'site_contacts', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', s.contact_name,
    'phone', s.contact_phone,
    'interest', s.contact_interest,
    'at', s.contact_at
  ) order by s.contact_at desc), '[]'::jsonb)
  into v_contacts
  from (
    select contact_name, contact_phone, contact_interest, contact_at
    from public.site_chat_sessions
    where company_id = p_company_id
      and contact_phone is not null
    order by contact_at desc
    limit 20
  ) s;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'attendance_mode', 'service',
    'site_contacts', v_contacts,
    'profile', jsonb_build_object(
      'preset', v_profile.service_preset,
      'context_text', v_profile.context_text,
      'agenda_enabled', v_profile.agenda_enabled,
      'cases_enabled', v_profile.cases_enabled,
      'whatsapp_cancel_enabled', v_profile.whatsapp_cancel_enabled,
      'whatsapp_reschedule_enabled', v_profile.whatsapp_reschedule_enabled,
      'site_chat_key', v_profile.site_chat_key,
      'site_chat_replies', to_jsonb(v_profile.site_chat_replies)
    )
  );
end;
$$;

