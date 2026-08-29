-- A5: Platform ops — courtesy trial (never-paid) + audit

create or replace function public.rpc_platform_grant_courtesy_trial(
  p_company_id   uuid,
  p_days         integer,
  p_actor_id     uuid,
  p_actor_email  text,
  p_actor_role   text,
  p_request_id   text,
  p_ip_address   text,
  p_user_agent   text,
  p_reason       text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub      record;
  v_plan_id  uuid;
  v_before   jsonb;
  v_after    jsonb;
  v_trial_end timestamptz;
begin
  if p_company_id is null then
    raise exception 'company_id required';
  end if;
  if p_days is null or p_days < 1 or p_days > 14 then
    raise exception 'courtesy trial days must be between 1 and 14';
  end if;

  select id, company_id, plan, status, trial_ends_at, last_paid_at, activated_at
    into v_sub
    from public.pagarme_subscriptions
   where company_id = p_company_id
   for update;

  if v_sub.id is null then
    raise exception 'pagarme_subscription_not_found';
  end if;

  if v_sub.last_paid_at is not null then
    raise exception 'company_already_paid';
  end if;

  if v_sub.status not in (
    'pending_payment'::public.pagarme_sub_status,
    'pending_setup'::public.pagarme_sub_status,
    'blocked'::public.pagarme_sub_status
  ) then
    raise exception 'status_not_eligible_for_courtesy_trial: %', v_sub.status;
  end if;

  v_trial_end := now() + (p_days || ' days')::interval;

  v_before := jsonb_build_object(
    'status', v_sub.status,
    'trial_ends_at', v_sub.trial_ends_at,
    'last_paid_at', v_sub.last_paid_at
  );

  update public.pagarme_subscriptions
     set status = 'trial'::public.pagarme_sub_status,
         trial_ends_at = v_trial_end,
         activated_at = coalesce(v_sub.activated_at, now()),
         updated_at = now()
   where id = v_sub.id;

  update public.companies
     set is_active = true
   where id = p_company_id;

  select id into v_plan_id
    from public.plans
   where key = v_sub.plan::text
   limit 1;

  if v_plan_id is not null then
    update public.subscriptions
       set plan_id = v_plan_id,
           status = 'active',
           started_at = coalesce(started_at, now())
     where company_id = p_company_id
       and status = 'active';

    if not found then
      insert into public.subscriptions (company_id, plan_id, status, started_at)
      values (p_company_id, v_plan_id, 'active', now());
    end if;
  end if;

  v_after := jsonb_build_object(
    'status', 'trial',
    'trial_ends_at', v_trial_end,
    'courtesy_days', p_days
  );

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.billing.courtesy_trial_granted', 'company', p_company_id::text,
    p_company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, ''), 'days', p_days),
    'success'
  );

  return v_trial_end;
end;
$$;

revoke all on function public.rpc_platform_grant_courtesy_trial(
  uuid, integer, uuid, text, text, text, text, text, text
) from public;

grant execute on function public.rpc_platform_grant_courtesy_trial(
  uuid, integer, uuid, text, text, text, text, text, text
) to service_role;
