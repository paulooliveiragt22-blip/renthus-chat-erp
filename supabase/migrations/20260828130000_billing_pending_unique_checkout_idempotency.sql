-- P0.6: no máximo uma fatura/setup pending por company + idempotency de checkout

-- Dedup: se já existir mais de um pending, mantém o mais recente
with ranked as (
  select id,
         row_number() over (partition by company_id order by created_at desc nulls last, id desc) as rn
    from public.invoices
   where status = 'pending'
)
update public.invoices i
   set status = 'cancelled'
  from ranked r
 where i.id = r.id
   and r.rn > 1;

with ranked as (
  select id,
         row_number() over (partition by company_id order by created_at desc nulls last, id desc) as rn
    from public.setup_payments
   where status = 'pending'
)
update public.setup_payments s
   set status = 'cancelled'
  from ranked r
 where s.id = r.id
   and r.rn > 1;

create unique index if not exists uq_invoices_one_pending_per_company
  on public.invoices (company_id)
  where (status = 'pending');

create unique index if not exists uq_setup_one_pending_per_company
  on public.setup_payments (company_id)
  where (status = 'pending');

create table if not exists public.billing_checkout_idempotency (
  id           text primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  response     jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists billing_checkout_idempotency_company_idx
  on public.billing_checkout_idempotency (company_id);

comment on table public.billing_checkout_idempotency is
  'Respostas cacheadas de create-invoice-checkout por Idempotency-Key (company_id:key).';

alter table public.billing_checkout_idempotency enable row level security;
alter table public.billing_checkout_idempotency force row level security;
revoke all on table public.billing_checkout_idempotency from anon;
revoke all on table public.billing_checkout_idempotency from authenticated;

drop policy if exists rls_billing_checkout_idempotency_service_role_only
  on public.billing_checkout_idempotency;
create policy rls_billing_checkout_idempotency_service_role_only
  on public.billing_checkout_idempotency
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
