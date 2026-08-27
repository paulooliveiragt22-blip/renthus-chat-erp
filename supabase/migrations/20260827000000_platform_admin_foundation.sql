-- Platform Admin Renthus/Lysthub — foundation (P0)

-- ─── platform_users ──────────────────────────────────────────────────────────
create table if not exists public.platform_users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  email         text not null,
  display_name  text not null,
  role          text not null check (role in ('superadmin', 'ops', 'billing', 'support', 'readonly')),
  is_active     boolean not null default true,
  mfa_required  boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists platform_users_role_idx on public.platform_users (role);
create index if not exists platform_users_active_idx on public.platform_users (is_active) where is_active = true;

comment on table public.platform_users is
  'Operadores Renthus/Lysthub (console /platform). Separado de company_users.';

-- ─── platform_audit_log (append-only) ───────────────────────────────────────
create table if not exists public.platform_audit_log (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor_id        uuid references public.platform_users(id) on delete set null,
  actor_email     text,
  actor_role      text,
  action          text not null,
  resource_type   text not null,
  resource_id     text,
  company_id      uuid references public.companies(id) on delete set null,
  request_id      text not null,
  ip_address      inet,
  user_agent      text,
  before_state    jsonb,
  after_state     jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  outcome         text not null default 'success'
    check (outcome in ('success', 'failure', 'denied'))
);

create index if not exists platform_audit_log_occurred_idx
  on public.platform_audit_log (occurred_at desc);
create index if not exists platform_audit_log_company_idx
  on public.platform_audit_log (company_id, occurred_at desc)
  where company_id is not null;
create index if not exists platform_audit_log_actor_idx
  on public.platform_audit_log (actor_id, occurred_at desc)
  where actor_id is not null;
create index if not exists platform_audit_log_action_idx
  on public.platform_audit_log (action, occurred_at desc);

comment on table public.platform_audit_log is
  'Audit append-only de ações no console platform. Sem UPDATE/DELETE.';

-- ─── platform_impersonation_sessions (P1) ────────────────────────────────────
create table if not exists public.platform_impersonation_sessions (
  id                uuid primary key default gen_random_uuid(),
  platform_user_id  uuid not null references public.platform_users(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,
  reason            text not null,
  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  ended_at          timestamptz
);

create index if not exists platform_impersonation_active_idx
  on public.platform_impersonation_sessions (platform_user_id, company_id)
  where ended_at is null;

-- ─── RLS hardening ───────────────────────────────────────────────────────────
alter table public.platform_users enable row level security;
alter table public.platform_users force row level security;
revoke all on table public.platform_users from anon;
revoke all on table public.platform_users from authenticated;

drop policy if exists rls_platform_users_service_role_only on public.platform_users;
create policy rls_platform_users_service_role_only on public.platform_users
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.platform_audit_log enable row level security;
alter table public.platform_audit_log force row level security;
revoke all on table public.platform_audit_log from anon;
revoke all on table public.platform_audit_log from authenticated;

drop policy if exists rls_platform_audit_log_service_role_only on public.platform_audit_log;
create policy rls_platform_audit_log_service_role_only on public.platform_audit_log
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.platform_impersonation_sessions enable row level security;
alter table public.platform_impersonation_sessions force row level security;
revoke all on table public.platform_impersonation_sessions from anon;
revoke all on table public.platform_impersonation_sessions from authenticated;

drop policy if exists rls_platform_impersonation_sessions_service_role_only on public.platform_impersonation_sessions;
create policy rls_platform_impersonation_sessions_service_role_only on public.platform_impersonation_sessions
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ─── RPC: record audit ───────────────────────────────────────────────────────
create or replace function public.rpc_platform_record_audit(
  p_actor_id        uuid,
  p_actor_email     text,
  p_actor_role      text,
  p_action          text,
  p_resource_type   text,
  p_resource_id     text,
  p_company_id      uuid,
  p_request_id      text,
  p_ip_address      text,
  p_user_agent      text,
  p_before_state    jsonb,
  p_after_state     jsonb,
  p_metadata        jsonb,
  p_outcome         text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_ip inet;
begin
  v_ip := nullif(trim(coalesce(p_ip_address, '')), '')::inet;

  insert into public.platform_audit_log (
    actor_id, actor_email, actor_role, action, resource_type, resource_id,
    company_id, request_id, ip_address, user_agent,
    before_state, after_state, metadata, outcome
  ) values (
    p_actor_id, p_actor_email, p_actor_role, p_action, p_resource_type, p_resource_id,
    p_company_id, p_request_id, v_ip, p_user_agent,
    p_before_state, p_after_state, coalesce(p_metadata, '{}'::jsonb),
    coalesce(nullif(trim(p_outcome), ''), 'success')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.rpc_platform_record_audit(
  uuid, text, text, text, text, text, uuid, text, text, text, jsonb, jsonb, jsonb, text
) from public;
grant execute on function public.rpc_platform_record_audit(
  uuid, text, text, text, text, text, uuid, text, text, text, jsonb, jsonb, jsonb, text
) to service_role;

-- ─── RPC: suspend company + audit ────────────────────────────────────────────
create or replace function public.rpc_platform_suspend_company(
  p_company_id   uuid,
  p_actor_id     uuid,
  p_actor_email  text,
  p_actor_role   text,
  p_request_id   text,
  p_ip_address   text,
  p_user_agent   text,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  select jsonb_build_object('is_active', is_active)
    into v_before
    from public.companies
   where id = p_company_id
   for update;

  if v_before is null then
    raise exception 'company_not_found';
  end if;

  update public.companies
     set is_active = false,
         updated_at = now()
   where id = p_company_id;

  v_after := jsonb_build_object('is_active', false);

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.company.suspended', 'company', p_company_id::text, p_company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, '')),
    'success'
  );
end;
$$;

revoke all on function public.rpc_platform_suspend_company(
  uuid, uuid, text, text, text, text, text, text
) from public;
grant execute on function public.rpc_platform_suspend_company(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

create or replace function public.rpc_platform_reactivate_company(
  p_company_id   uuid,
  p_actor_id     uuid,
  p_actor_email  text,
  p_actor_role   text,
  p_request_id   text,
  p_ip_address   text,
  p_user_agent   text,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  select jsonb_build_object('is_active', is_active)
    into v_before
    from public.companies
   where id = p_company_id
   for update;

  if v_before is null then
    raise exception 'company_not_found';
  end if;

  update public.companies
     set is_active = true,
         updated_at = now()
   where id = p_company_id;

  v_after := jsonb_build_object('is_active', true);

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.company.reactivated', 'company', p_company_id::text, p_company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, '')),
    'success'
  );
end;
$$;

revoke all on function public.rpc_platform_reactivate_company(
  uuid, uuid, text, text, text, text, text, text
) from public;
grant execute on function public.rpc_platform_reactivate_company(
  uuid, uuid, text, text, text, text, text, text
) to service_role;
