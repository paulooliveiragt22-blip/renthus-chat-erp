-- Office é outro produto. A linha do plano separa a escada do Delivery
-- da cobrança do Office. O anual é desconto fixo: 12 × R$ 159 − R$ 709,20
-- = R$ 1.198,80. O desconto padrão de 20% cobraria R$ 127,20 por mês.

alter type public.subscription_plan add value if not exists 'office';

alter table public.plans
  add column if not exists product_line text not null default 'delivery';

alter table public.plans
  drop constraint if exists plans_product_line_check;

alter table public.plans
  add constraint plans_product_line_check
  check (product_line in ('delivery', 'office'));

comment on column public.plans.product_line is
  'delivery = Essencial, Pro e Market. office = plano Office. Upgrade não cruza a linha.';

-- O gatilho comparava enum com text e quebrava qualquer insert de plano.
create or replace function public.tg_plans_sync_ai_wallet_budget()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.price_cents is not distinct from old.price_cents then
    return new;
  end if;
  update public.company_ai_wallets w
     set included_budget_cents = public.fn_billing_ai_included_cents(new.price_cents),
         updated_at = now()
   where exists (
     select 1
       from public.pagarme_subscriptions ps
      where ps.company_id = w.company_id
        and ps.plan::text = new.key
   );
  return new;
end;
$$;

revoke all on function public.tg_plans_sync_ai_wallet_budget() from public;
revoke all on function public.tg_plans_sync_ai_wallet_budget() from anon;
revoke all on function public.tg_plans_sync_ai_wallet_budget() from authenticated;

insert into public.plans (
  key,
  name,
  description,
  price_cents,
  price_year_cents,
  included_seats,
  seat_extra_cents,
  yearly_discount_mode,
  yearly_discount_value,
  product_line
)
values (
  'office',
  'Office',
  'Agente no WhatsApp, agenda e card do serviço',
  15900,
  119880,
  1,
  null,
  'fixed_brl',
  70920,
  'office'
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  price_year_cents = excluded.price_year_cents,
  included_seats = excluded.included_seats,
  seat_extra_cents = excluded.seat_extra_cents,
  yearly_discount_mode = excluded.yearly_discount_mode,
  yearly_discount_value = excluded.yearly_discount_value,
  product_line = excluded.product_line;

insert into public.features (key, description)
values
  ('whatsapp_messages', 'Mensagens WhatsApp'),
  ('ai_parser', 'Agente de IA'),
  ('assisted_mode', 'Modo assistido'),
  ('ai_credit_packs', 'Packs de crédito IA'),
  ('whatsapp_templates_broadcast', 'Templates e envio em massa no WhatsApp')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_key)
select p.id, f.key
from public.plans p
cross join (
  values
    ('whatsapp_messages'),
    ('ai_parser'),
    ('assisted_mode'),
    ('ai_credit_packs'),
    ('whatsapp_templates_broadcast')
) as f(key)
where p.key = 'office'
on conflict do nothing;

-- Troca de plano entre Delivery e Office morre aqui, mesmo se uma RPC esquecer a lista.
create or replace function public.trg_billing_reject_cross_product_line()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_current text;
  v_next text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.plan is distinct from old.plan then
    select product_line into v_current from public.plans where key = old.plan::text;
    select product_line into v_next from public.plans where key = new.plan::text;
    if v_current is not null and v_next is not null and v_current <> v_next then
      raise exception 'cross_product_line' using errcode = 'P0001';
    end if;
  end if;

  if new.pending_plan_key is not null then
    select product_line into v_current from public.plans where key = new.plan::text;
    select product_line into v_next from public.plans where key = new.pending_plan_key;
    if v_current is not null and v_next is not null and v_current <> v_next then
      raise exception 'cross_product_line' using errcode = 'P0001';
    end if;
  end if;

  if new.pending_upgrade_plan_key is not null then
    select product_line into v_current from public.plans where key = new.plan::text;
    select product_line into v_next from public.plans where key = new.pending_upgrade_plan_key;
    if v_current is not null and v_next is not null and v_current <> v_next then
      raise exception 'cross_product_line' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_billing_reject_cross_product_line() from public;
revoke all on function public.trg_billing_reject_cross_product_line() from anon;
revoke all on function public.trg_billing_reject_cross_product_line() from authenticated;

drop trigger if exists trg_billing_reject_cross_product_line on public.pagarme_subscriptions;

create trigger trg_billing_reject_cross_product_line
before update of plan, pending_plan_key, pending_upgrade_plan_key
on public.pagarme_subscriptions
for each row
execute function public.trg_billing_reject_cross_product_line();

-- Cadastro: plano office nasce em modo serviço, modelo balcão.
-- Agenda e card ficam desligados até a empresa mudar no painel.
create or replace function public.rpc_signup_company_with_billing(
  p_auth_user_id uuid,
  p_company_name text,
  p_cnpj text,
  p_email text,
  p_whatsapp_phone text,
  p_plan text,
  p_trial_days integer,
  p_billing_period text default 'month'
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
  v_line text;
  v_now timestamptz := now();
  v_trial_ends timestamptz;
  v_payment_required boolean;
  v_cnpj text;
  v_whatsapp text;
  v_period text;
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_id required';
  end if;

  v_period := lower(coalesce(nullif(btrim(p_billing_period), ''), 'month'));
  if v_period not in ('month', 'year') then
    raise exception 'invalid billing_period: %', p_billing_period;
  end if;

  v_cnpj := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  if length(v_cnpj) <> 14 then
    raise exception 'invalid cnpj';
  end if;

  v_whatsapp := regexp_replace(coalesce(p_whatsapp_phone, ''), '\D', '', 'g');
  if length(v_whatsapp) < 10 then
    raise exception 'invalid whatsapp';
  end if;

  select p.product_line into v_line
  from public.plans p
  where p.key = lower(btrim(coalesce(p_plan, '')))
  limit 1;

  if v_line is null or lower(btrim(p_plan)) not in ('essencial', 'pro', 'market', 'office') then
    raise exception 'invalid plan: %', p_plan;
  end if;

  begin
    v_plan := lower(btrim(p_plan))::public.subscription_plan;
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
    attendance_mode
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
    case when v_payment_required then null else v_now end,
    case when v_line = 'office' then 'service' else 'delivery' end
  )
  returning id into v_company_id;

  insert into public.company_users (company_id, user_id, role, is_active)
  values (v_company_id, p_auth_user_id, 'owner', true);

  insert into public.pagarme_subscriptions (
    company_id,
    plan,
    status,
    billing_period,
    trial_ends_at,
    activated_at,
    pagarme_customer_id
  )
  values (
    v_company_id,
    v_plan,
    case when v_payment_required then 'pending_payment'::public.pagarme_sub_status
         else 'trial'::public.pagarme_sub_status end,
    v_period,
    v_trial_ends,
    case when v_payment_required then null else v_now end,
    null
  )
  on conflict (company_id) do update set
    plan = excluded.plan,
    status = excluded.status,
    billing_period = excluded.billing_period,
    trial_ends_at = excluded.trial_ends_at,
    activated_at = excluded.activated_at,
    updated_at = now();

  if v_line = 'office' then
    insert into public.service_profiles (
      company_id, service_preset, agenda_enabled, cases_enabled
    )
    values (v_company_id, 'balcao', false, false)
    on conflict (company_id) do update
      set service_preset = 'balcao',
          agenda_enabled = false,
          cases_enabled = false,
          whatsapp_cancel_enabled = false,
          whatsapp_reschedule_enabled = false,
          updated_at = now();
  end if;

  if not v_payment_required then
    select id into v_plan_id
    from public.plans
    where key = lower(btrim(p_plan))
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
  uuid, text, text, text, text, text, integer, text
) from public;
revoke all on function public.rpc_signup_company_with_billing(
  uuid, text, text, text, text, text, integer, text
) from anon;
revoke all on function public.rpc_signup_company_with_billing(
  uuid, text, text, text, text, text, integer, text
) from authenticated;

grant execute on function public.rpc_signup_company_with_billing(
  uuid, text, text, text, text, text, integer, text
) to service_role;

comment on function public.rpc_signup_company_with_billing(
  uuid, text, text, text, text, text, integer, text
) is
  'Signup transacional. office nasce attendance_mode=service e preset balcão. Delivery não aplica preset.';
