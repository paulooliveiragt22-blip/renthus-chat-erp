-- Seleção de plano ≠ cobrança: intent fica na assinatura; invoice só no pagar (create-invoice-checkout).

alter table public.pagarme_subscriptions
  add column if not exists pending_upgrade_plan_key text null,
  add column if not exists pending_checkout_intent text null;

alter table public.pagarme_subscriptions
  drop constraint if exists pagarme_subscriptions_pending_upgrade_plan_key_check;

alter table public.pagarme_subscriptions
  add constraint pagarme_subscriptions_pending_upgrade_plan_key_check
  check (
    pending_upgrade_plan_key is null
    or pending_upgrade_plan_key in ('essencial', 'pro', 'market')
  );

alter table public.pagarme_subscriptions
  drop constraint if exists pagarme_subscriptions_pending_checkout_intent_check;

alter table public.pagarme_subscriptions
  add constraint pagarme_subscriptions_pending_checkout_intent_check
  check (
    pending_checkout_intent is null
    or pending_checkout_intent in ('period_switch')
  );

comment on column public.pagarme_subscriptions.pending_upgrade_plan_key is
  'Upgrade mid-cycle selecionado (BN-11). Invoice plan_upgrade só ao pagar.';

comment on column public.pagarme_subscriptions.pending_checkout_intent is
  'Checkout pendente sem invoice (ex.: period_switch). Invoice só ao pagar.';
