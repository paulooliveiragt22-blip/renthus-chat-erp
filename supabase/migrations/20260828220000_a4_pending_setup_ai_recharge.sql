-- A4: legado pending_setup + ensure_first_invoice
-- R4/R5: unique ledger order_id + ai_recharge_jobs outbox

-- A4.1 — pending_setup sem setup pendente → pending_payment (setup fee desligado / morto)
update public.pagarme_subscriptions ps
set status = 'pending_payment'::public.pagarme_sub_status,
    updated_at = now()
where ps.status = 'pending_setup'::public.pagarme_sub_status
  and ps.last_paid_at is null
  and not exists (
    select 1
    from public.setup_payments sp
    where sp.company_id = ps.company_id
      and sp.status = 'pending'
  );

-- A4.4 — subscriptions.active indevida em never-paid
update public.subscriptions s
set status = 'suspended'
from public.pagarme_subscriptions ps
where ps.company_id = s.company_id
  and s.status = 'active'
  and ps.last_paid_at is null
  and ps.status in (
    'pending_payment'::public.pagarme_sub_status,
    'pending_setup'::public.pagarme_sub_status
  );

-- A4.2 — RPC idempotente: garante invoice pending (amount em BRL, ex. 197.00)
create or replace function public.rpc_ensure_first_invoice(
  p_company_id uuid,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub_id uuid;
  v_status public.pagarme_sub_status;
  v_existing uuid;
  v_invoice_id uuid;
begin
  if p_company_id is null then
    raise exception 'company_id required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select id, status
    into v_sub_id, v_status
    from public.pagarme_subscriptions
   where company_id = p_company_id
   limit 1;

  if v_sub_id is null then
    raise exception 'pagarme_subscription not found';
  end if;

  if v_status not in (
    'pending_payment'::public.pagarme_sub_status,
    'overdue'::public.pagarme_sub_status,
    'trial'::public.pagarme_sub_status
  ) then
    raise exception 'subscription status % not eligible for first invoice', v_status;
  end if;

  select id into v_existing
    from public.invoices
   where company_id = p_company_id
     and status = 'pending'
   limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.invoices (
    company_id,
    subscription_id,
    amount,
    status,
    due_at,
    pagarme_order_id,
    pagarme_payment_url,
    pix_qr_code
  )
  values (
    p_company_id,
    v_sub_id,
    p_amount,
    'pending',
    now(),
    null,
    null,
    null
  )
  returning id into v_invoice_id;

  return v_invoice_id;
exception
  when unique_violation then
    select id into v_existing
      from public.invoices
     where company_id = p_company_id
       and status = 'pending'
     limit 1;
    return v_existing;
end;
$$;

revoke all on function public.rpc_ensure_first_invoice(uuid, numeric) from public;
grant execute on function public.rpc_ensure_first_invoice(uuid, numeric) to service_role;

-- A4.3 — backfill never-paid sem invoice pending (preços ref. catálogo 2026-08)
insert into public.invoices (
  company_id,
  subscription_id,
  amount,
  status,
  due_at,
  pagarme_order_id,
  pagarme_payment_url,
  pix_qr_code
)
select
  ps.company_id,
  ps.id,
  case ps.plan::text
    when 'pro' then 279.00
    when 'market' then 397.00
    else 197.00
  end,
  'pending',
  now(),
  null,
  null,
  null
from public.pagarme_subscriptions ps
where ps.status = 'pending_payment'::public.pagarme_sub_status
  and ps.last_paid_at is null
  and not exists (
    select 1
    from public.invoices i
    where i.company_id = ps.company_id
      and i.status = 'pending'
  );

-- R4 — anti double-credit por order_id no ledger
create unique index if not exists company_ai_ledger_pagarme_order_id_uidx
  on public.company_ai_ledger ((meta->>'pagarme_order_id'))
  where kind = 'pack_credit'
    and meta ? 'pagarme_order_id'
    and (meta->>'pagarme_order_id') is not null
    and (meta->>'pagarme_order_id') <> '';

-- R5 — outbox recarga IA automática
alter table public.company_ai_wallets
  add column if not exists auto_recharge_last_error text;

comment on column public.company_ai_wallets.auto_recharge_last_error is
  'Último erro de auto-recarga (cartão recusado / sem cartão). Limpo ao creditar pack.';

create table if not exists public.ai_recharge_jobs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  pack_cents       integer not null,
  status           text not null default 'pending',
  pagarme_order_id text,
  attempt_count    integer not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  processed_at     timestamptz,
  constraint ai_recharge_jobs_pack_cents_check
    check (pack_cents in (1000, 2000, 5000)),
  constraint ai_recharge_jobs_status_check
    check (status in ('pending', 'processing', 'completed', 'failed'))
);

create unique index if not exists ai_recharge_jobs_one_active_per_company
  on public.ai_recharge_jobs (company_id)
  where status in ('pending', 'processing');

create index if not exists ai_recharge_jobs_pending_created_idx
  on public.ai_recharge_jobs (created_at asc)
  where status = 'pending';

comment on table public.ai_recharge_jobs is
  'Outbox: auto-recarga IA off-session (cron). Crédito só via FulfillPayment.';

alter table public.ai_recharge_jobs enable row level security;
alter table public.ai_recharge_jobs force row level security;
revoke all on table public.ai_recharge_jobs from anon;
revoke all on table public.ai_recharge_jobs from authenticated;

drop policy if exists rls_ai_recharge_jobs_service_role_only on public.ai_recharge_jobs;
create policy rls_ai_recharge_jobs_service_role_only
  on public.ai_recharge_jobs
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
