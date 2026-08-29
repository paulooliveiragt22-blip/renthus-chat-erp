-- B4.1: never-paid com is_active=true indevido → false (até fulfill / cortesia)

update public.companies c
set is_active = false
from public.pagarme_subscriptions ps
where ps.company_id = c.id
  and ps.last_paid_at is null
  and ps.status in (
    'pending_payment'::public.pagarme_sub_status,
    'pending_setup'::public.pagarme_sub_status,
    'blocked'::public.pagarme_sub_status
  )
  and c.is_active = true;

comment on column public.companies.is_active is
  'Operacional (bot/canais). false para never-paid até pagamento; trial/active pago true.';
