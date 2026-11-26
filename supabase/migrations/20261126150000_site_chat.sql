-- Chat público da vitrine. A conversa é da empresa de serviço Zampell.
-- O teto de 8 mensagens do visitante espelha SITE_CHAT_MESSAGE_CAP.

update public.companies
set name = 'Zampell'
where id = '0113a3fe-e224-49ff-81c6-f8b9df556267'
  and attendance_mode = 'service'
  and name = 'Ferrester Serviço';

create table if not exists public.site_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  message_count integer not null default 0 check (message_count >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists site_chat_sessions_company_idx
  on public.site_chat_sessions (company_id);

create table if not exists public.site_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.site_chat_sessions (id) on delete cascade,
  company_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  body text not null check (char_length(body) between 1 and 2000),
  links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists site_chat_messages_session_idx
  on public.site_chat_messages (session_id, created_at);
create index if not exists site_chat_messages_company_idx
  on public.site_chat_messages (company_id);

alter table public.site_chat_sessions enable row level security;
alter table public.site_chat_sessions force row level security;
alter table public.site_chat_messages enable row level security;
alter table public.site_chat_messages force row level security;

revoke all on table public.site_chat_sessions from anon, authenticated;
revoke all on table public.site_chat_messages from anon, authenticated;

drop policy if exists rls_site_chat_sessions_service_role_only on public.site_chat_sessions;
create policy rls_site_chat_sessions_service_role_only on public.site_chat_sessions
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists rls_site_chat_messages_service_role_only on public.site_chat_messages;
create policy rls_site_chat_messages_service_role_only on public.site_chat_messages
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.rpc_site_chat_begin(
  p_company_id uuid,
  p_session_id uuid,
  p_body text,
  p_reset boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_body text;
  v_session uuid;
  v_count integer;
  v_expires timestamptz;
  v_message uuid;
  v_history jsonb;
begin
  select attendance_mode into v_mode
    from public.companies
   where id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null or char_length(v_body) > 500 then
    return jsonb_build_object('ok', false, 'code', 'body_invalid');
  end if;

  if p_reset is not true and p_session_id is not null then
    select id, message_count, expires_at
      into v_session, v_count, v_expires
      from public.site_chat_sessions
     where id = p_session_id
       and company_id = p_company_id
     for update;
  end if;

  if v_session is null or v_expires <= now() then
    insert into public.site_chat_sessions (company_id, message_count, expires_at)
    values (p_company_id, 0, now() + interval '24 hours')
    returning id, message_count into v_session, v_count;
  end if;

  if v_count >= 8 then
    return jsonb_build_object(
      'ok', false,
      'code', 'session_cap',
      'session_id', v_session,
      'remaining', 0
    );
  end if;

  insert into public.site_chat_messages (session_id, company_id, role, body)
  values (v_session, p_company_id, 'user', v_body)
  returning id into v_message;

  update public.site_chat_sessions
     set message_count = message_count + 1
   where id = v_session
  returning message_count into v_count;

  select coalesce(
    (
      select jsonb_agg(jsonb_build_object('role', h.role, 'body', h.body) order by h.created_at)
        from (
          select role, body, created_at
            from public.site_chat_messages
           where session_id = v_session
             and id <> v_message
           order by created_at desc
           limit 12
        ) h
    ),
    '[]'::jsonb
  ) into v_history;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'session_id', v_session,
    'message_id', v_message,
    'remaining', 8 - v_count,
    'history', v_history
  );
end;
$$;

create or replace function public.rpc_site_chat_finish(
  p_company_id uuid,
  p_session_id uuid,
  p_body text,
  p_links jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text;
  v_links jsonb := '[]'::jsonb;
  v_item jsonb;
begin
  if not exists (
    select 1
      from public.site_chat_sessions
     where id = p_session_id
       and company_id = p_company_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'session_invalid');
  end if;

  v_body := left(btrim(coalesce(p_body, '')), 2000);
  if v_body = '' then
    v_body := 'Não consegui responder agora. Tente de novo em instantes.';
  end if;

  if jsonb_typeof(p_links) = 'array' then
    for v_item in select value from jsonb_array_elements(p_links)
    loop
      if jsonb_array_length(v_links) >= 3 then
        exit;
      end if;
      if jsonb_typeof(v_item) <> 'object' then
        continue;
      end if;
      if (v_item->>'label') not in ('Ver oferta', 'Ver plano', 'Ver serviço') then
        continue;
      end if;
      if coalesce(v_item->>'url', '') !~ '^https://[^[:space:]]+$' then
        continue;
      end if;
      if char_length(v_item->>'url') > 500 then
        continue;
      end if;
      v_links := v_links || jsonb_build_array(jsonb_build_object('label', v_item->>'label', 'url', v_item->>'url'));
    end loop;
  end if;

  insert into public.site_chat_messages (session_id, company_id, role, body, links)
  values (p_session_id, p_company_id, 'assistant', v_body, v_links);

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

create or replace function public.rpc_site_chat_read(
  p_company_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_expires timestamptz;
  v_messages jsonb;
begin
  select message_count, expires_at
    into v_count, v_expires
    from public.site_chat_sessions
   where id = p_session_id
     and company_id = p_company_id;

  if v_count is null or v_expires <= now() then
    return jsonb_build_object('ok', true, 'code', 'ok', 'messages', '[]'::jsonb, 'remaining', 8);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('role', m.role, 'body', m.body, 'links', m.links)
      order by m.created_at
    ),
    '[]'::jsonb
  )
    into v_messages
    from public.site_chat_messages m
   where m.session_id = p_session_id
     and m.company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'messages', v_messages,
    'remaining', greatest(0, 8 - v_count)
  );
end;
$$;

revoke all on function public.rpc_site_chat_begin(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.rpc_site_chat_finish(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_site_chat_read(uuid, uuid) from public, anon, authenticated;

grant execute on function public.rpc_site_chat_begin(uuid, uuid, text, boolean) to service_role;
grant execute on function public.rpc_site_chat_finish(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.rpc_site_chat_read(uuid, uuid) to service_role;
