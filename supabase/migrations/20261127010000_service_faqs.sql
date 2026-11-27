create table if not exists public.service_faqs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  question text not null,
  answer text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_faqs_question_len check (char_length(btrim(question)) between 1 and 200),
  constraint service_faqs_answer_len check (char_length(btrim(answer)) between 1 and 1000)
);

create index if not exists service_faqs_company_idx
  on public.service_faqs (company_id);

comment on table public.service_faqs is
  'Pergunta e resposta escritas pela empresa. O atendente só usa as ativas. Teto de 40 ativas, validado na RPC.';

alter table public.service_faqs enable row level security;
alter table public.service_faqs force row level security;

revoke all on table public.service_faqs from anon, authenticated;

drop policy if exists rls_service_faqs_service_role_only on public.service_faqs;
create policy rls_service_faqs_service_role_only on public.service_faqs
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.rpc_service_list_faqs(
  p_company_id uuid,
  p_active_only boolean
)
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
        'id', f.id,
        'question', f.question,
        'answer', f.answer,
        'active', f.active
      ) order by f.created_at, f.id)
      from public.service_faqs f
      where f.company_id = p_company_id
        and (not coalesce(p_active_only, false) or f.active)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_service_upsert_faq(
  p_company_id uuid,
  p_faq_id uuid,
  p_question text,
  p_answer text,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_question text;
  v_answer text;
  v_active boolean;
  v_id uuid;
  v_count integer;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;

  v_question := btrim(coalesce(p_question, ''));
  v_answer := btrim(coalesce(p_answer, ''));
  if char_length(v_question) < 1 or char_length(v_question) > 200
     or char_length(v_answer) < 1 or char_length(v_answer) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'faq_invalid');
  end if;

  v_active := coalesce(p_active, true);
  if v_active then
    select count(*) into v_count
    from public.service_faqs f
    where f.company_id = p_company_id
      and f.active
      and (p_faq_id is null or f.id <> p_faq_id);
    if v_count >= 40 then
      return jsonb_build_object('ok', false, 'code', 'faq_limit');
    end if;
  end if;

  if p_faq_id is null then
    insert into public.service_faqs (company_id, question, answer, active)
    values (p_company_id, v_question, v_answer, v_active)
    returning id into v_id;
  else
    update public.service_faqs
      set question = v_question,
          answer = v_answer,
          active = v_active,
          updated_at = now()
      where id = p_faq_id
        and company_id = p_company_id
      returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok', 'faq_id', v_id);
end;
$$;

create or replace function public.rpc_service_delete_faq(
  p_company_id uuid,
  p_faq_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_id uuid;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  if p_faq_id is null then
    return jsonb_build_object('ok', false, 'code', 'faq_invalid');
  end if;

  delete from public.service_faqs
  where id = p_faq_id
    and company_id = p_company_id
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'cross_tenant');
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok', 'faq_id', v_id);
end;
$$;

revoke all on function public.rpc_service_list_faqs(uuid, boolean) from public, anon, authenticated;
revoke all on function public.rpc_service_upsert_faq(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.rpc_service_delete_faq(uuid, uuid) from public, anon, authenticated;

grant execute on function public.rpc_service_list_faqs(uuid, boolean) to service_role;
grant execute on function public.rpc_service_upsert_faq(uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.rpc_service_delete_faq(uuid, uuid) to service_role;
