-- B3.5: lifecycle webhook + dead-letter de fulfill permanente

alter table public.pagarme_webhook_events
  add column if not exists status text not null default 'completed',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_error text;

alter table public.pagarme_webhook_events
  drop constraint if exists pagarme_webhook_events_status_check;

alter table public.pagarme_webhook_events
  add constraint pagarme_webhook_events_status_check
  check (status in ('processing', 'completed', 'failed_retryable', 'failed_permanent'));

comment on column public.pagarme_webhook_events.status is
  'processing → completed | failed_retryable (PSP retry) | failed_permanent (dead-letter)';

create table if not exists public.billing_fulfill_failures (
  id          uuid primary key default gen_random_uuid(),
  event_key   text not null,
  event_type  text,
  order_id    text,
  error       text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists billing_fulfill_failures_created_at_idx
  on public.billing_fulfill_failures (created_at desc);

create index if not exists billing_fulfill_failures_event_key_idx
  on public.billing_fulfill_failures (event_key);

comment on table public.billing_fulfill_failures is
  'Dead-letter: fulfill permanente (HTTP 200). Transient usa failed_retryable + HTTP 500.';

alter table public.billing_fulfill_failures enable row level security;
alter table public.billing_fulfill_failures force row level security;

revoke all on table public.billing_fulfill_failures from anon;
revoke all on table public.billing_fulfill_failures from authenticated;

drop policy if exists rls_billing_fulfill_failures_service_role_only
  on public.billing_fulfill_failures;

create policy rls_billing_fulfill_failures_service_role_only
  on public.billing_fulfill_failures
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- webhook events: force RLS + revoke + policy (tabela antiga pode estar frouxa)
alter table public.pagarme_webhook_events enable row level security;
alter table public.pagarme_webhook_events force row level security;
revoke all on table public.pagarme_webhook_events from anon;
revoke all on table public.pagarme_webhook_events from authenticated;

drop policy if exists rls_pagarme_webhook_events_service_role_only
  on public.pagarme_webhook_events;
drop policy if exists pagarme_webhook_events_service on public.pagarme_webhook_events;

create policy rls_pagarme_webhook_events_service_role_only
  on public.pagarme_webhook_events
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
