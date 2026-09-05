-- Cron expire-trials: trial vencido → pending_payment (com plano) | pending_setup (sem plano).
-- Desativa companies.is_active na mesma txn. Não marca abandoned.

create or replace function public.rpc_expire_due_trials(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap int;
  v_n int;
  v_ids uuid[];
begin
  v_cap := greatest(1, least(coalesce(p_limit, 100), 500));

  with due as (
    select ps.id
      from public.pagarme_subscriptions ps
     where ps.status = 'trial'::public.pagarme_sub_status
       and ps.trial_ends_at is not null
       and ps.trial_ends_at <= now()
     order by ps.trial_ends_at asc nulls last
     limit v_cap
  ),
  upd as (
    update public.pagarme_subscriptions ps
       set status = case
         when ps.plan is not null and length(trim(ps.plan::text)) > 0
           then 'pending_payment'::public.pagarme_sub_status
         else 'pending_setup'::public.pagarme_sub_status
       end
      from due
     where ps.id = due.id
       and ps.status = 'trial'::public.pagarme_sub_status
    returning ps.company_id
  ),
  deact as (
    update public.companies c
       set is_active = false
     where c.id in (select u.company_id from upd u)
       and c.is_active is distinct from false
    returning c.id
  )
  select count(*)::int, coalesce(array_agg(u.company_id), array[]::uuid[])
    into v_n, v_ids
    from upd u;

  return jsonb_build_object(
    'status', 'ok',
    'expired', v_n,
    'company_ids', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.rpc_expire_due_trials(integer) from public;
revoke all on function public.rpc_expire_due_trials(integer) from anon;
revoke all on function public.rpc_expire_due_trials(integer) from authenticated;
grant execute on function public.rpc_expire_due_trials(integer) to service_role;

comment on function public.rpc_expire_due_trials(integer) is
  'Batch: trial com trial_ends_at <= now → pending_payment|pending_setup + company inativa. CAS status=trial.';
