-- BN-05 / BN-13-R1: kind=setup abolido. Histórico vira subscription (mesmo amount/status).
-- CHECK sem setup; obligation/fulfill já rejeitam setup novo.

update public.invoices
   set kind = 'subscription'
 where kind = 'setup';

alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices
  add constraint invoices_kind_check
  check (kind in (
    'subscription',
    'year',
    'seat_add',
    'ai_pack',
    'plan_upgrade',
    'period_switch'
  ));
