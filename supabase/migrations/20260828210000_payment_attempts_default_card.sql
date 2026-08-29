-- R1: default_card_id + payment_attempts (auditoria de coleta card/PIX)

alter table public.pagarme_subscriptions
  add column if not exists default_card_id text;

comment on column public.pagarme_subscriptions.default_card_id is
  'card_id Pagar.me preferido para renovação off-session (nunca PAN).';

create table if not exists public.payment_attempts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  invoice_id        uuid references public.invoices(id) on delete set null,
  setup_payment_id  uuid references public.setup_payments(id) on delete set null,
  kind              text not null,
  channel           text not null,
  pagarme_order_id  text,
  status            text not null,
  decline_code      text,
  attempt_n         int not null default 1,
  error_message     text,
  created_at        timestamptz not null default now(),
  constraint payment_attempts_kind_check
    check (kind in ('subscription_renewal', 'subscription_first', 'setup', 'ai_pack')),
  constraint payment_attempts_channel_check
    check (channel in ('card', 'pix')),
  constraint payment_attempts_status_check
    check (status in ('pending', 'paid', 'failed', 'void'))
);

create unique index if not exists payment_attempts_pagarme_order_id_uidx
  on public.payment_attempts (pagarme_order_id)
  where pagarme_order_id is not null;

create index if not exists payment_attempts_company_id_created_at_idx
  on public.payment_attempts (company_id, created_at desc);

create index if not exists payment_attempts_invoice_id_idx
  on public.payment_attempts (invoice_id)
  where invoice_id is not null;

comment on table public.payment_attempts is
  'Auditoria de CollectPayment: card-first + PIX fallback; unique order_id anti-duplicidade.';

alter table public.payment_attempts enable row level security;
alter table public.payment_attempts force row level security;

revoke all on table public.payment_attempts from anon;
revoke all on table public.payment_attempts from authenticated;

drop policy if exists rls_payment_attempts_service_role_only on public.payment_attempts;

create policy rls_payment_attempts_service_role_only
  on public.payment_attempts
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
