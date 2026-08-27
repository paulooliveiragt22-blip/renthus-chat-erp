-- Platform Admin P2.1 — feature flags (global + override por empresa)

create table if not exists public.platform_feature_flags (
  key             text primary key
    check (key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  description     text not null default '',
  enabled_global  boolean not null default false,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.platform_feature_flags is
  'Kill-switches / flags operacionais cross-tenant do console /platform.';

create table if not exists public.platform_feature_flag_overrides (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  key         text not null references public.platform_feature_flags(key) on delete cascade,
  enabled     boolean not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, key)
);

create index if not exists platform_feature_flag_overrides_company_idx
  on public.platform_feature_flag_overrides (company_id);
create index if not exists platform_feature_flag_overrides_key_idx
  on public.platform_feature_flag_overrides (key);

comment on table public.platform_feature_flag_overrides is
  'Override por company_id de platform_feature_flags (vence o global).';

-- RLS
alter table public.platform_feature_flags enable row level security;
alter table public.platform_feature_flags force row level security;
revoke all on table public.platform_feature_flags from anon;
revoke all on table public.platform_feature_flags from authenticated;

drop policy if exists rls_platform_feature_flags_service_role_only
  on public.platform_feature_flags;
create policy rls_platform_feature_flags_service_role_only
  on public.platform_feature_flags
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.platform_feature_flag_overrides enable row level security;
alter table public.platform_feature_flag_overrides force row level security;
revoke all on table public.platform_feature_flag_overrides from anon;
revoke all on table public.platform_feature_flag_overrides from authenticated;

drop policy if exists rls_platform_feature_flag_overrides_service_role_only
  on public.platform_feature_flag_overrides;
create policy rls_platform_feature_flag_overrides_service_role_only
  on public.platform_feature_flag_overrides
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Resolução server-side (service_role)
create or replace function public.rpc_platform_is_feature_enabled(
  p_key text,
  p_company_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_global boolean;
  v_override boolean;
begin
  select f.enabled_global into v_global
  from public.platform_feature_flags f
  where f.key = p_key;

  if not found then
    return false;
  end if;

  if p_company_id is not null then
    select o.enabled into v_override
    from public.platform_feature_flag_overrides o
    where o.key = p_key and o.company_id = p_company_id;

    if found then
      return v_override;
    end if;
  end if;

  return coalesce(v_global, false);
end;
$$;

revoke all on function public.rpc_platform_is_feature_enabled(text, uuid) from public;
grant execute on function public.rpc_platform_is_feature_enabled(text, uuid) to service_role;

-- Seeds mínimos (ops pode ligar/desligar via UI)
insert into public.platform_feature_flags (key, description, enabled_global)
values
  ('platform.maintenance_banner', 'Exibe banner de manutenção no console tenant', false),
  ('chatbot.outbound_paused', 'Pausa jobs outbound WhatsApp (kill-switch)', false),
  ('billing.enforce_plan_gates', 'Enforça gates de plano no admin', true)
on conflict (key) do nothing;
