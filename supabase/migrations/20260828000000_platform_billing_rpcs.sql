-- Platform Admin P1 — billing RPCs + impersonation audit actions support

create or replace function public.rpc_platform_change_subscription_plan(
  p_subscription_id uuid,
  p_plan_key        text,
  p_actor_id        uuid,
  p_actor_email     text,
  p_actor_role      text,
  p_request_id      text,
  p_ip_address      text,
  p_user_agent      text,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub     record;
  v_plan_id uuid;
  v_before  jsonb;
  v_after   jsonb;
begin
  select s.id, s.company_id, s.plan_id, s.status, s.allow_overage, p.key as plan_key
    into v_sub
    from public.subscriptions s
    left join public.plans p on p.id = s.plan_id
   where s.id = p_subscription_id
   for update of s;

  if v_sub.id is null then
    raise exception 'subscription_not_found';
  end if;

  select id into v_plan_id
    from public.plans
   where key = trim(p_plan_key)
   limit 1;

  if v_plan_id is null then
    raise exception 'plan_not_found';
  end if;

  v_before := jsonb_build_object(
    'plan_id', v_sub.plan_id,
    'plan_key', v_sub.plan_key,
    'status', v_sub.status
  );

  update public.subscriptions
     set plan_id = v_plan_id
   where id = p_subscription_id;

  v_after := jsonb_build_object(
    'plan_id', v_plan_id,
    'plan_key', trim(p_plan_key),
    'status', v_sub.status
  );

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.subscription.plan_changed', 'subscription', p_subscription_id::text,
    v_sub.company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, '')),
    'success'
  );
end;
$$;

revoke all on function public.rpc_platform_change_subscription_plan(
  uuid, text, uuid, text, text, text, text, text, text
) from public;
grant execute on function public.rpc_platform_change_subscription_plan(
  uuid, text, uuid, text, text, text, text, text, text
) to service_role;

create or replace function public.rpc_platform_set_subscription_overage(
  p_subscription_id uuid,
  p_allow_overage   boolean,
  p_actor_id        uuid,
  p_actor_email     text,
  p_actor_role      text,
  p_request_id      text,
  p_ip_address      text,
  p_user_agent      text,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub    record;
  v_before jsonb;
  v_after  jsonb;
begin
  select id, company_id, allow_overage
    into v_sub
    from public.subscriptions
   where id = p_subscription_id
   for update;

  if v_sub.id is null then
    raise exception 'subscription_not_found';
  end if;

  v_before := jsonb_build_object('allow_overage', v_sub.allow_overage);

  update public.subscriptions
     set allow_overage = p_allow_overage
   where id = p_subscription_id;

  v_after := jsonb_build_object('allow_overage', p_allow_overage);

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.subscription.overage_changed', 'subscription', p_subscription_id::text,
    v_sub.company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, '')),
    'success'
  );
end;
$$;

revoke all on function public.rpc_platform_set_subscription_overage(
  uuid, boolean, uuid, text, text, text, text, text, text
) from public;
grant execute on function public.rpc_platform_set_subscription_overage(
  uuid, boolean, uuid, text, text, text, text, text, text
) to service_role;
