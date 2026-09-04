-- EX2: unificar setup_payments ∪ invoices (kind) + pending_setup → pending_payment
-- Idempotente / pré-produção radical (ADR-0006).

-- 1) kind em invoices
alter table public.invoices
  add column if not exists kind text;

update public.invoices
set kind = 'subscription'
where kind is null or btrim(kind) = '';

alter table public.invoices
  alter column kind set default 'subscription';

alter table public.invoices
  alter column kind set not null;

do $$
begin
  alter table public.invoices
    add constraint invoices_kind_check
    check (kind in ('setup', 'subscription'));
exception
  when duplicate_object then null;
end $$;

-- 2) Backfill setup_payments → invoices (preserva id p/ payment_attempts)
insert into public.invoices (
  id,
  company_id,
  subscription_id,
  amount,
  status,
  due_at,
  paid_at,
  pagarme_order_id,
  pagarme_payment_url,
  pix_qr_code,
  kind,
  created_at,
  attempt_count
)
select
  sp.id,
  sp.company_id,
  ps.id,
  sp.amount,
  sp.status,
  coalesce(sp.paid_at, sp.created_at, now()),
  sp.paid_at,
  sp.pagarme_order_id,
  sp.pagarme_payment_url,
  sp.pix_qr_code,
  'setup',
  coalesce(sp.created_at, now()),
  0
from public.setup_payments sp
inner join public.pagarme_subscriptions ps
  on ps.company_id = sp.company_id
where not exists (
  select 1 from public.invoices i where i.id = sp.id
);

-- Setup órfão sem subscription: não deve existir; se existir, falha explícita
do $$
declare
  n int;
begin
  select count(*)::int into n
  from public.setup_payments sp
  where not exists (
    select 1 from public.pagarme_subscriptions ps where ps.company_id = sp.company_id
  );
  if n > 0 then
    raise exception 'EX2: % setup_payments sem pagarme_subscriptions', n;
  end if;
end $$;

-- 3) Consolidar dual pending (setup + subscription): falha o setup pending
update public.invoices i
set status = 'failed'
where i.kind = 'setup'
  and i.status = 'pending'
  and exists (
    select 1
    from public.invoices j
    where j.company_id = i.company_id
      and j.kind = 'subscription'
      and j.status = 'pending'
  );

-- 4) Remap payment_attempts.setup_payment_id → invoice_id
update public.payment_attempts pa
set invoice_id = pa.setup_payment_id
where pa.setup_payment_id is not null
  and pa.invoice_id is null
  and exists (
    select 1 from public.invoices i where i.id = pa.setup_payment_id
  );

alter table public.payment_attempts
  drop constraint if exists payment_attempts_setup_payment_id_fkey;

alter table public.payment_attempts
  drop column if exists setup_payment_id;

-- 5) Unique: um pending por (company_id, kind)
drop index if exists public.uq_setup_one_pending_per_company;
drop index if exists public.uq_invoices_one_pending_per_company;

create unique index if not exists uq_invoices_one_pending_per_company_kind
  on public.invoices (company_id, kind)
  where (status = 'pending');

-- 6) pending_setup → pending_payment (enum value pode permanecer unused)
update public.pagarme_subscriptions
set status = 'pending_payment'::public.pagarme_sub_status,
    updated_at = now()
where status = 'pending_setup'::public.pagarme_sub_status;

-- 7) DROP setup_payments
drop table if exists public.setup_payments cascade;

-- 8) rpc_ensure_first_invoice: kind=subscription; drop overload legado (uuid)
drop function if exists public.rpc_ensure_first_invoice(uuid);

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
     and kind = 'subscription'
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
    pix_qr_code,
    kind
  )
  values (
    p_company_id,
    v_sub_id,
    p_amount,
    'pending',
    now(),
    null,
    null,
    null,
    'subscription'
  )
  returning id into v_invoice_id;

  return v_invoice_id;
exception
  when unique_violation then
    select id into v_existing
      from public.invoices
     where company_id = p_company_id
       and status = 'pending'
       and kind = 'subscription'
     limit 1;
    return v_existing;
end;
$$;

revoke all on function public.rpc_ensure_first_invoice(uuid, numeric) from public;
grant execute on function public.rpc_ensure_first_invoice(uuid, numeric) to service_role;
