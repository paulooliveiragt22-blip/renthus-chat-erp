-- Visita da landpage: um navegador por dia. A conversa com a IA continua em site_chat_sessions.

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  visitor_key uuid not null,
  path text not null check (path = '/'),
  day date not null,
  created_at timestamptz not null default now(),
  unique (company_id, visitor_key, day, path)
);

create index if not exists site_visits_company_day_idx
  on public.site_visits (company_id, day);

alter table public.site_visits enable row level security;
alter table public.site_visits force row level security;

revoke all on table public.site_visits from public, anon, authenticated;

drop policy if exists rls_site_visits_service_role_only on public.site_visits;
create policy rls_site_visits_service_role_only on public.site_visits
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.rpc_site_visit_record(
  p_company_id uuid,
  p_visitor_key uuid,
  p_path text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_tz text;
  v_day date;
begin
  if p_visitor_key is null or p_path is distinct from '/' then
    return jsonb_build_object('ok', false, 'code', 'visit_invalid');
  end if;

  select attendance_mode into v_mode
    from public.companies
   where id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  select c.time_zone into v_tz from public.fn_service_company_clock(p_company_id) c;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'America/Cuiaba');
  begin
    v_day := (timezone(v_tz, now()))::date;
  exception
    when invalid_parameter_value then
      v_day := (timezone('America/Cuiaba', now()))::date;
  end;

  insert into public.site_visits (company_id, visitor_key, path, day)
  values (p_company_id, p_visitor_key, '/', v_day)
  on conflict (company_id, visitor_key, day, path) do nothing;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_site_audience_summary(
  p_company_id uuid,
  p_days integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_tz text;
  v_today date;
  v_from date;
  v_visits bigint;
  v_chats bigint;
begin
  if p_days is null or p_days not in (1, 7, 30) then
    return jsonb_build_object('ok', false, 'code', 'days_invalid');
  end if;

  select attendance_mode into v_mode
    from public.companies
   where id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  select c.time_zone into v_tz from public.fn_service_company_clock(p_company_id) c;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'America/Cuiaba');
  begin
    v_today := (timezone(v_tz, now()))::date;
  exception
    when invalid_parameter_value then
      v_tz := 'America/Cuiaba';
      v_today := (timezone('America/Cuiaba', now()))::date;
  end;
  v_from := v_today - (p_days - 1);

  select count(distinct visitor_key)
    into v_visits
    from public.site_visits
   where company_id = p_company_id
     and day between v_from and v_today;

  select count(*)
    into v_chats
    from public.site_chat_sessions
   where company_id = p_company_id
     and message_count >= 1
     and (created_at at time zone v_tz)::date between v_from and v_today;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'days', p_days,
    'visits', v_visits,
    'chats', v_chats
  );
end;
$$;

revoke all on function public.rpc_site_visit_record(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_site_audience_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.rpc_site_visit_record(uuid, uuid, text) to service_role;
grant execute on function public.rpc_site_audience_summary(uuid, integer) to service_role;
