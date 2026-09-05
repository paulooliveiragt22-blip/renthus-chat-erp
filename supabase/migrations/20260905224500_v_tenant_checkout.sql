-- View read-only: tenant em fase de checkout (pay-to-start / obrigação aberta).
-- Não substitui resolveEffectiveBillingStatus no app; consolida sinais SQL para ops/superadmin.

create or replace view public.v_tenant_checkout
with (security_invoker = true)
as
select
  ps.company_id,
  ps.id                    as subscription_id,
  ps.status                as subscription_status,
  ps.plan,
  ps.plan_key,
  ps.billing_period,
  ps.last_paid_at,
  ps.trial_ends_at,
  c.is_active              as company_is_active,
  c.onboarding_completed_at,
  (ps.status = 'pending_payment'::public.pagarme_sub_status and ps.last_paid_at is null)
    as is_initial_checkout,
  inv.id                   as pending_invoice_id,
  inv.amount               as pending_invoice_amount_brl,
  inv.kind                 as pending_invoice_kind,
  inv.status               as pending_invoice_status
from public.pagarme_subscriptions ps
join public.companies c on c.id = ps.company_id
left join lateral (
  select i.id, i.amount, i.kind, i.status
  from public.invoices i
  where i.company_id = ps.company_id
    and i.status = 'pending'::public.pagarme_invoice_status
  order by i.created_at desc
  limit 1
) inv on true;

comment on view public.v_tenant_checkout is
  'Checkout phase: pending_payment never-paid + optional invoice pending. SELECT ops/service_role.';

revoke all on public.v_tenant_checkout from public;
revoke all on public.v_tenant_checkout from anon;
revoke all on public.v_tenant_checkout from authenticated;
grant select on public.v_tenant_checkout to service_role;
