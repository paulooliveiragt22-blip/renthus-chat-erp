-- Platform billing settings (default trial days) + status pending_payment (pay-to-start)

alter type public.pagarme_sub_status add value if not exists 'pending_payment';

create table if not exists public.platform_billing_settings (
  id                 smallint primary key default 1 check (id = 1),
  default_trial_days int not null default 0
    check (default_trial_days >= 0 and default_trial_days <= 90),
  updated_at         timestamptz not null default now(),
  updated_by         uuid null references public.platform_users(id) on delete set null
);

comment on table public.platform_billing_settings is
  'Singleton: política global de trial SaaS (dias grátis no signup). 0 = pay-to-start.';

insert into public.platform_billing_settings (id, default_trial_days)
values (1, 0)
on conflict (id) do nothing;

alter table public.platform_billing_settings enable row level security;
alter table public.platform_billing_settings force row level security;
revoke all on table public.platform_billing_settings from anon;
revoke all on table public.platform_billing_settings from authenticated;

drop policy if exists rls_platform_billing_settings_service_role_only
  on public.platform_billing_settings;
create policy rls_platform_billing_settings_service_role_only
  on public.platform_billing_settings
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
