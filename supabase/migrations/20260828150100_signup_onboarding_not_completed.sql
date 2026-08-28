-- P1.5: trial signup não marca onboarding_completed_at (wizard /ativar)

create or replace function public.rpc_signup_company_with_billing(
  p_auth_user_id uuid,
  p_company_name text,
  p_cnpj text,
  p_email text,
  p_whatsapp_phone text,
  p_plan text,
  p_trial_days integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_plan public.subscription_plan;
  v_plan_id uuid;
  v_now timestamptz := now();
  v_trial_ends timestamptz;
  v_payment_required boolean;
  v_cnpj text;
  v_whatsapp text;
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_id required';
  end if;

  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  if length(v_cnpj) <> 14 then
    raise exception 'invalid cnpj';
  end if;

  v_whatsapp := regexp_replace(coalesce(p_whatsapp_phone, ''), '\D', '', 'g');
  if length(v_whatsapp) < 10 then
    raise exception 'invalid whatsapp';
  end if;

  begin
    v_plan := p_plan::public.subscription_plan;
  exception
    when invalid_text_representation then
      raise exception 'invalid plan: %', p_plan;
  end;

  v_payment_required := coalesce(p_trial_days, 0) = 0;

  if v_payment_required then
    v_trial_ends := v_now;
  else
    v_trial_ends := v_now + (p_trial_days || ' days')::interval;
  end if;

  insert into public.companies (
    nome_fantasia,
    cnpj,
    name,
    email,
    whatsapp_phone,
    meta,
    is_active,
    senha_definida,
    onboarding_completed_at,
    onboarding_step
  )
  values (
    trim(p_company_name),
    v_cnpj,
    trim(p_company_name),
    lower(trim(p_email)),
    v_whatsapp,
    jsonb_build_object('cnpj', v_cnpj),
    not v_payment_required,
    true,
    null,
    0
  )
  returning id into v_company_id;

  insert into public.company_users (company_id, user_id, role, is_active)
  values (v_company_id, p_auth_user_id, 'owner', true);

  insert into public.pagarme_subscriptions (
    company_id,
    plan,
    status,
    trial_ends_at,
    activated_at,
    pagarme_customer_id
  )
  values (
    v_company_id,
    v_plan,
    case when v_payment_required then 'pending_payment'::public.pagarme_sub_status
         else 'trial'::public.pagarme_sub_status end,
    v_trial_ends,
    case when v_payment_required then null else v_now end,
    null
  )
  on conflict (company_id) do update set
    plan = excluded.plan,
    status = excluded.status,
    trial_ends_at = excluded.trial_ends_at,
    activated_at = excluded.activated_at,
    updated_at = now();

  if not v_payment_required then
    select id into v_plan_id
    from public.plans
    where key = p_plan
    limit 1;

    if v_plan_id is not null then
      update public.subscriptions
      set plan_id = v_plan_id, started_at = v_now
      where company_id = v_company_id and status = 'active';

      if not found then
        insert into public.subscriptions (company_id, plan_id, status, started_at)
        values (v_company_id, v_plan_id, 'active', v_now);
      end if;
    end if;
  end if;

  return v_company_id;
end;
$$;

revoke all on function public.rpc_signup_company_with_billing(
  uuid, text, text, text, text, text, integer
) from public;

grant execute on function public.rpc_signup_company_with_billing(
  uuid, text, text, text, text, text, integer
) to service_role;
