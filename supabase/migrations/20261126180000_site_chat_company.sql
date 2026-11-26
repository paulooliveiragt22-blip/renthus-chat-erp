-- ADR 0018. Cada empresa de serviço tem uma chave pública do chat.
-- O browser manda a chave, nunca o company_id. Preço e agenda continuam no turno.

alter table public.service_profiles
  add column if not exists site_chat_key uuid not null default gen_random_uuid();

alter table public.service_profiles
  add column if not exists site_chat_replies text[] not null default array[]::text[];

create unique index if not exists service_profiles_site_chat_key_uq
  on public.service_profiles (site_chat_key);

create or replace function public.site_chat_replies_valid(p_replies text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(cardinality(p_replies), 0) <= 3
     and not exists (
       select 1
         from unnest(coalesce(p_replies, array[]::text[])) as reply
        where reply is null
           or char_length(btrim(reply)) < 1
           or char_length(reply) > 80
     );
$$;

revoke all on function public.site_chat_replies_valid(text[]) from public, anon, authenticated;
grant execute on function public.site_chat_replies_valid(text[]) to service_role;

alter table public.service_profiles
  drop constraint if exists service_profiles_site_replies_check;

alter table public.service_profiles
  add constraint service_profiles_site_replies_check
  check (public.site_chat_replies_valid(site_chat_replies));

update public.service_profiles
   set site_chat_replies = array[
     'Quais planos vocês têm?',
     'Quanto custa o Pro?',
     'Quero falar com alguém'
   ]::text[]
 where company_id = '0113a3fe-e224-49ff-81c6-f8b9df556267'
   and cardinality(site_chat_replies) = 0;

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
      'whatsapp_reschedule_enabled', v_profile.whatsapp_reschedule_enabled,
      'site_chat_key', v_profile.site_chat_key,
      'site_chat_replies', to_jsonb(v_profile.site_chat_replies)
    )
  );
end;
$$;

create or replace function public.rpc_service_save_site_replies(
  p_company_id uuid,
  p_replies text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_reply text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  if p_replies is null or cardinality(p_replies) > 3 then
    return jsonb_build_object('ok', false, 'code', 'replies_invalid');
  end if;
  foreach v_reply in array p_replies loop
    if char_length(btrim(coalesce(v_reply, ''))) < 1 or char_length(v_reply) > 80 then
      return jsonb_build_object('ok', false, 'code', 'replies_invalid');
    end if;
  end loop;
  update public.service_profiles
     set site_chat_replies = p_replies,
         updated_at = now()
   where company_id = p_company_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_site_chat_public(p_key uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_name text;
  v_replies text[];
begin
  select c.id, c.name, p.site_chat_replies
    into v_company, v_name, v_replies
    from public.service_profiles p
    join public.companies c on c.id = p.company_id
   where p.site_chat_key = p_key
     and c.attendance_mode = 'service';
  if v_company is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'company_id', v_company,
    'company_name', coalesce(v_name, ''),
    'replies', to_jsonb(v_replies)
  );
end;
$$;

create or replace function public.rpc_site_chat_public_company(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_key uuid;
  v_name text;
  v_replies text[];
begin
  select p.site_chat_key, c.name, p.site_chat_replies
    into v_key, v_name, v_replies
    from public.service_profiles p
    join public.companies c on c.id = p.company_id
   where p.company_id = p_company_id
     and c.attendance_mode = 'service';
  if v_key is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'company_id', p_company_id,
    'company_name', coalesce(v_name, ''),
    'site_chat_key', v_key,
    'replies', to_jsonb(v_replies)
  );
end;
$$;

revoke all on function public.rpc_service_save_site_replies(uuid, text[]) from public, anon, authenticated;
revoke all on function public.rpc_site_chat_public(uuid) from public, anon, authenticated;
revoke all on function public.rpc_site_chat_public_company(uuid) from public, anon, authenticated;

grant execute on function public.rpc_service_save_site_replies(uuid, text[]) to service_role;
grant execute on function public.rpc_site_chat_public(uuid) to service_role;
grant execute on function public.rpc_site_chat_public_company(uuid) to service_role;
