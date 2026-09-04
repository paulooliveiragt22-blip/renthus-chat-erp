-- H5.5 R11b: última invoice por company_id sem puxar o histórico inteiro para o Node.
-- DISTINCT ON no Postgres; EXECUTE só service_role.

create or replace function public.rpc_last_invoices_by_company(p_company_ids uuid[])
returns table (
  id uuid,
  company_id uuid,
  subscription_id uuid,
  amount numeric,
  status text,
  due_at timestamptz,
  paid_at timestamptz,
  pagarme_order_id text,
  pix_qr_code text,
  pagarme_payment_url text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (i.company_id)
    i.id,
    i.company_id,
    i.subscription_id,
    i.amount,
    i.status::text,
    i.due_at,
    i.paid_at,
    i.pagarme_order_id,
    i.pix_qr_code,
    i.pagarme_payment_url,
    i.created_at
  from public.invoices i
  where p_company_ids is not null
    and cardinality(p_company_ids) > 0
    and i.company_id = any (p_company_ids)
  order by i.company_id, i.created_at desc nulls last;
$$;

revoke all on function public.rpc_last_invoices_by_company(uuid[]) from public;
revoke all on function public.rpc_last_invoices_by_company(uuid[]) from anon;
revoke all on function public.rpc_last_invoices_by_company(uuid[]) from authenticated;
grant execute on function public.rpc_last_invoices_by_company(uuid[]) to service_role;
