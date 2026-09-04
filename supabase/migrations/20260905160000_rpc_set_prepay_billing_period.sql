-- Troca de ciclo ANTES do 1º pagamento (pending/trial never-paid).
-- Não é pay-to-switch (R2-5): ainda não há crédito a abater.
-- Fonte canônica de preço continua rpc_create_billing_obligation após o flip.

create or replace function public.rpc_set_prepay_billing_period(
  p_company_id uuid,
  p_period     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub        public.pagarme_subscriptions%rowtype;
  v_period     text;
  v_cancelled  int := 0;
begin
  v_period := lower(trim(coalesce(p_period, '')));
  if v_period not in ('month', 'year') then
    raise exception 'period_invalid' using errcode = 'P0001';
  end if;
  if p_company_id is null then
    raise exception 'company_id_required' using errcode = 'P0001';
  end if;

  select * into v_sub
    from public.pagarme_subscriptions
   where company_id = p_company_id
   for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'P0001';
  end if;

  if v_sub.last_paid_at is not null then
    raise exception 'already_paid' using errcode = 'P0001';
  end if;

  if lower(coalesce(v_sub.status::text, '')) not in (
    'pending_payment', 'pending_setup', 'trial'
  ) then
    raise exception 'subscription_not_eligible' using errcode = 'P0001';
  end if;

  update public.pagarme_subscriptions
     set billing_period = v_period,
         updated_at = now()
   where id = v_sub.id;

  update public.invoices
     set status = 'cancelled'
   where company_id = p_company_id
     and status = 'pending'
     and kind in ('subscription', 'year');
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object(
    'ok', true,
    'billing_period', v_period,
    'cancelled_pending', v_cancelled
  );
end;
$$;

revoke all on function public.rpc_set_prepay_billing_period(uuid, text) from public;
revoke all on function public.rpc_set_prepay_billing_period(uuid, text) from anon;
revoke all on function public.rpc_set_prepay_billing_period(uuid, text) from authenticated;
grant execute on function public.rpc_set_prepay_billing_period(uuid, text) to service_role;

comment on function public.rpc_set_prepay_billing_period(uuid, text) is
  'ADR-0006 D10: seta billing_period month|year só se never-paid (pending/trial). Cancela invoices subscription|year pendentes.';
