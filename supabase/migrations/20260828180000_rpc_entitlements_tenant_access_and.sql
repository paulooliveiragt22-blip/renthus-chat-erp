-- A2: entitlements AND TenantAccess — features só se access allow
-- Espelha lib/billing/tenantAccess.ts / resolveBillingAccess.ts

create or replace function public.rpc_get_company_entitlements(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pagarme record;
  v_sub record;
  v_features jsonb := '[]'::jsonb;
  v_reason text := 'missing';
  v_access text := 'deny';
  v_features_eligible boolean := false;
  v_now timestamptz := now();
begin
  if p_company_id is null then
    return jsonb_build_object(
      'company_id', null,
      'access', 'deny',
      'access_reason', 'missing',
      'features_eligible', false,
      'features', '[]'::jsonb
    );
  end if;

  select
    ps.status,
    ps.plan,
    ps.trial_ends_at,
    ps.last_paid_at,
    ps.next_billing_at,
    ps.activated_at
  into v_pagarme
  from public.pagarme_subscriptions ps
  where ps.company_id = p_company_id
  limit 1;

  -- Matriz efetiva (mesma de resolveEffectiveBillingStatus)
  if v_pagarme.status is null then
    v_reason := 'missing';
  else
    case lower(v_pagarme.status::text)
      when 'blocked' then v_reason := 'blocked';
      when 'cancelled' then v_reason := 'cancelled';
      when 'pending_payment' then v_reason := 'pending_payment';
      when 'pending_setup' then v_reason := 'pending_setup';
      when 'active' then v_reason := 'active';
      when 'trial' then
        if v_pagarme.trial_ends_at is null
           or v_pagarme.trial_ends_at <= v_now then
          v_reason := 'trial_expired';
        else
          v_reason := 'trial';
        end if;
      when 'overdue' then
        if v_pagarme.last_paid_at is not null then
          v_reason := 'overdue';
        else
          v_reason := 'pending_payment';
        end if;
      else
        v_reason := 'missing';
    end case;
  end if;

  -- Gate full: trial | active | overdue (com last_paid)
  if v_reason in ('trial', 'active', 'overdue') then
    v_access := 'allow';
    v_features_eligible := true;
  else
    v_access := 'deny';
    v_features_eligible := false;
  end if;

  select
    s.id,
    s.plan_id,
    s.status,
    s.allow_overage,
    p.key as plan_key,
    p.name as plan_name
  into v_sub
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.company_id = p_company_id
    and s.status = 'active'
  order by s.started_at desc nulls last
  limit 1;

  -- Features só se elegível (AND billing access)
  if v_features_eligible and v_sub.plan_id is not null then
    select coalesce(jsonb_agg(distinct f.feature_key order by f.feature_key), '[]'::jsonb)
    into v_features
    from (
      select pf.feature_key::text as feature_key
      from public.plan_features pf
      where pf.plan_id = v_sub.plan_id
      union
      select sa.feature_key::text
      from public.subscription_addons sa
      where sa.company_id = p_company_id
    ) f;
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'access', v_access,
    'access_reason', v_reason,
    'features_eligible', v_features_eligible,
    'pagarme', case
      when v_pagarme.status is null then null
      else jsonb_build_object(
        'status', v_pagarme.status,
        'plan', v_pagarme.plan,
        'trial_ends_at', v_pagarme.trial_ends_at,
        'last_paid_at', v_pagarme.last_paid_at,
        'next_billing_at', v_pagarme.next_billing_at,
        'activated_at', v_pagarme.activated_at
      )
    end,
    'subscription', case
      when (not v_features_eligible) or v_sub.id is null then null
      else jsonb_build_object(
        'id', v_sub.id,
        'plan_id', v_sub.plan_id,
        'plan_key', v_sub.plan_key,
        'plan_name', v_sub.plan_name,
        'status', v_sub.status,
        'allow_overage', coalesce(v_sub.allow_overage, false)
      )
    end,
    'features', v_features
  );
end;
$$;

revoke all on function public.rpc_get_company_entitlements(uuid) from public;
grant execute on function public.rpc_get_company_entitlements(uuid) to service_role;

comment on function public.rpc_get_company_entitlements(uuid) is
  'Entitlements canônicos: features[] vazio se TenantAccess deny (pending_*, blocked, trial expirado, overdue never-paid).';
