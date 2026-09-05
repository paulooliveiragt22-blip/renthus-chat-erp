-- Transições críticas de pagarme_subscriptions.status no banco (CAS + allowlist).
-- Cron/collect deixam de .update({ status }) direto — race fulfill→active vs overdue/block.
-- Grace abandoned = interval '14 days' (mesmo ABANDONED_GRACE_DAYS do cron).

create or replace function public.rpc_transition_billing_status(
  p_company_id uuid,
  p_to text,
  p_cas_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_to text := lower(trim(coalesce(p_to, '')));
  v_sub public.pagarme_subscriptions%rowtype;
  v_from text;
  v_updated public.pagarme_subscriptions%rowtype;
  v_paid boolean;
  v_ok_from boolean;
begin
  if v_to not in ('overdue', 'pending_payment', 'blocked', 'abandoned') then
    raise exception 'unsupported_status_transition: %', p_to using errcode = 'P0001';
  end if;

  select * into v_sub
    from public.pagarme_subscriptions
   where company_id = p_company_id
   limit 1;

  if not found then
    raise exception 'subscription_not_found for company %', p_company_id using errcode = 'P0001';
  end if;

  v_from := v_sub.status::text;
  v_paid := v_sub.last_paid_at is not null;

  if v_from = v_to then
    if v_to = 'blocked' then
      update public.companies
         set is_active = false
       where id = p_company_id
         and is_active is distinct from false;
    end if;
    return jsonb_build_object(
      'status', 'already',
      'claimed', false,
      'from', v_from,
      'to', v_to
    );
  end if;

  if p_cas_updated_at is not null and v_sub.updated_at is distinct from p_cas_updated_at then
    return jsonb_build_object(
      'status', 'conflict',
      'claimed', false,
      'from', v_from,
      'to', v_to,
      'reason', 'cas_mismatch'
    );
  end if;

  v_ok_from := case v_to
    when 'overdue' then
      v_from in ('active', 'overdue') and v_paid
    when 'pending_payment' then
      v_from in ('trial', 'active', 'overdue', 'pending_payment') and not v_paid
    when 'blocked' then
      v_from in ('active', 'overdue') and v_paid
    when 'abandoned' then
      v_from in ('pending_payment', 'pending_setup')
      and not v_paid
      and v_sub.abandoned_at is null
      and v_sub.created_at <= now() - interval '14 days'
      and exists (
        select 1 from public.companies c
         where c.id = p_company_id
           and c.is_active = false
      )
    else false
  end;

  if not v_ok_from then
    return jsonb_build_object(
      'status', 'conflict',
      'claimed', false,
      'from', v_from,
      'to', v_to,
      'reason', 'not_allowed'
    );
  end if;

  update public.pagarme_subscriptions
     set status = v_to::public.pagarme_sub_status
   where company_id = p_company_id
     and status = v_sub.status
     and (p_cas_updated_at is null or updated_at = p_cas_updated_at)
     and (
       case v_to
         when 'overdue' then last_paid_at is not null
         when 'pending_payment' then last_paid_at is null
         when 'blocked' then last_paid_at is not null
         when 'abandoned' then
           last_paid_at is null
           and abandoned_at is null
           and created_at <= now() - interval '14 days'
         else false
       end
     )
  returning * into v_updated;

  if not found then
    return jsonb_build_object(
      'status', 'conflict',
      'claimed', false,
      'from', v_from,
      'to', v_to,
      'reason', 'cas_lost'
    );
  end if;

  if v_to = 'blocked' then
    update public.companies
       set is_active = false
     where id = p_company_id;
  end if;

  return jsonb_build_object(
    'status', 'transitioned',
    'claimed', true,
    'from', v_from,
    'to', v_to
  );
end;
$$;

revoke all on function public.rpc_transition_billing_status(uuid, text, timestamptz) from public;
revoke all on function public.rpc_transition_billing_status(uuid, text, timestamptz) from anon;
revoke all on function public.rpc_transition_billing_status(uuid, text, timestamptz) from authenticated;
grant execute on function public.rpc_transition_billing_status(uuid, text, timestamptz) to service_role;

comment on function public.rpc_transition_billing_status(uuid, text, timestamptz) is
  'CAS + allowlist: overdue/pending_payment/blocked/abandoned. blocked desativa companies.is_active na mesma txn.';

create or replace function public.rpc_mark_abandoned_due()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_n int;
begin
  with upd as (
    update public.pagarme_subscriptions ps
       set status = 'abandoned'::public.pagarme_sub_status
      from public.companies c
     where c.id = ps.company_id
       and ps.status in ('pending_payment', 'pending_setup')
       and ps.last_paid_at is null
       and ps.abandoned_at is null
       and ps.created_at <= now() - interval '14 days'
       and c.is_active = false
    returning ps.company_id
  )
  select count(*)::int, coalesce(array_agg(company_id), array[]::uuid[])
    into v_n, v_ids
    from upd;

  return jsonb_build_object(
    'status', 'ok',
    'marked', v_n,
    'company_ids', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.rpc_mark_abandoned_due() from public;
revoke all on function public.rpc_mark_abandoned_due() from anon;
revoke all on function public.rpc_mark_abandoned_due() from authenticated;
grant execute on function public.rpc_mark_abandoned_due() to service_role;

comment on function public.rpc_mark_abandoned_due() is
  'Batch: pending_setup|pending_payment never-paid, empresa inativa, created_at + 14d → abandoned. Trigger preenche abandoned_at.';
