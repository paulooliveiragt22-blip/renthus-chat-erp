-- Admin Web Push subscriptions (alertas pedido/handover com app fechado)
-- RLS service_role only (padrão pós-hardening)

create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists admin_push_subscriptions_company_idx
  on public.admin_push_subscriptions (company_id);

create index if not exists admin_push_subscriptions_user_idx
  on public.admin_push_subscriptions (user_id);

alter table public.admin_push_subscriptions enable row level security;
alter table public.admin_push_subscriptions force row level security;

revoke all on table public.admin_push_subscriptions from anon;
revoke all on table public.admin_push_subscriptions from authenticated;

drop policy if exists rls_admin_push_subscriptions_service_role_only
  on public.admin_push_subscriptions;

create policy rls_admin_push_subscriptions_service_role_only
  on public.admin_push_subscriptions
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
