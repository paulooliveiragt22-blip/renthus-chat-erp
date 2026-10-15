-- ADR 0016 emenda: saldo de IA só muda em RPC (dono da tabela).
-- service_role perde INSERT/UPDATE/DELETE/TRUNCATE. Leitura do saldo continua.
-- Reserva antes da chamada; liquidação idempotente; média por pedido da empresa.

alter table public.company_ai_wallets
  add column if not exists reserved_cents integer not null default 0,
  add column if not exists last_debit_cents integer not null default 0;

alter table public.company_ai_wallets
  drop constraint if exists company_ai_wallets_reserved_cents_check,
  drop constraint if exists company_ai_wallets_last_debit_cents_check,
  drop constraint if exists company_ai_wallets_included_spent_nonneg,
  drop constraint if exists company_ai_wallets_included_budget_nonneg,
  drop constraint if exists company_ai_wallets_prepaid_nonneg;

alter table public.company_ai_wallets
  add constraint company_ai_wallets_reserved_cents_check check (reserved_cents >= 0),
  add constraint company_ai_wallets_last_debit_cents_check check (last_debit_cents >= 0),
  add constraint company_ai_wallets_included_spent_nonneg check (included_spent_cents >= 0),
  add constraint company_ai_wallets_included_budget_nonneg check (included_budget_cents >= 0),
  add constraint company_ai_wallets_prepaid_nonneg check (prepaid_balance_cents >= 0);

alter table public.company_ai_ledger
  add column if not exists idempotency_key text,
  add column if not exists attributed_order_id uuid references public.orders(id) on delete set null;

create unique index if not exists company_ai_ledger_idempotency_key_uidx
  on public.company_ai_ledger (company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists company_ai_ledger_attributed_order_idx
  on public.company_ai_ledger (attributed_order_id)
  where attributed_order_id is not null;

create index if not exists company_ai_ledger_unattributed_thread_idx
  on public.company_ai_ledger (company_id, ((meta->>'thread_id')))
  where attributed_order_id is null
    and kind in ('included_debit', 'prepaid_debit');

create table if not exists public.company_ai_holds (
  company_id uuid not null references public.companies(id) on delete cascade,
  idempotency_key text not null,
  hold_cents integer not null check (hold_cents > 0),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (company_id, idempotency_key)
);

create table if not exists public.company_ai_order_usage (
  order_id uuid primary key references public.orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  thread_id uuid not null,
  call_count integer not null default 0 check (call_count >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists company_ai_order_usage_company_idx
  on public.company_ai_order_usage (company_id, created_at desc);

alter table public.company_ai_holds enable row level security;
alter table public.company_ai_holds force row level security;
alter table public.company_ai_order_usage enable row level security;
alter table public.company_ai_order_usage force row level security;

revoke all on table public.company_ai_holds from public;
revoke all on table public.company_ai_holds from anon;
revoke all on table public.company_ai_holds from authenticated;
revoke all on table public.company_ai_holds from service_role;

revoke all on table public.company_ai_order_usage from public;
revoke all on table public.company_ai_order_usage from anon;
revoke all on table public.company_ai_order_usage from authenticated;
revoke all on table public.company_ai_order_usage from service_role;

drop policy if exists rls_company_ai_holds_service_role_only on public.company_ai_holds;
create policy rls_company_ai_holds_service_role_only on public.company_ai_holds
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists rls_company_ai_order_usage_service_role_only on public.company_ai_order_usage;
create policy rls_company_ai_order_usage_service_role_only on public.company_ai_order_usage
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke insert, update, delete, truncate on table public.company_ai_wallets from service_role;
revoke insert, update, delete, truncate on table public.company_ai_ledger from service_role;

create or replace function public.rpc_ensure_ai_wallet(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ym text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_budget integer := public.rpc_ai_included_budget(p_company_id);
  v_row public.company_ai_wallets%rowtype;
  v_included_left integer;
  v_remaining integer;
begin
  insert into public.company_ai_wallets (
    company_id, period_ym, included_budget_cents, included_spent_cents, prepaid_balance_cents
  ) values (
    p_company_id, v_ym, v_budget, 0, 0
  )
  on conflict (company_id) do nothing;

  select * into v_row
    from public.company_ai_wallets
   where company_id = p_company_id
   for update;

  if v_row.period_ym is distinct from v_ym and v_row.reserved_cents = 0 then
    update public.company_ai_wallets
       set period_ym = v_ym,
           included_budget_cents = v_budget,
           included_spent_cents = 0,
           updated_at = now()
     where company_id = p_company_id
     returning * into v_row;
    insert into public.company_ai_ledger (company_id, kind, amount_cents, meta)
    values (p_company_id, 'period_reset', v_budget, jsonb_build_object('period_ym', v_ym));
  elsif v_row.included_budget_cents is distinct from v_budget then
    update public.company_ai_wallets
       set included_budget_cents = v_budget,
           updated_at = now()
     where company_id = p_company_id
     returning * into v_row;
  end if;

  v_included_left := greatest(0, v_row.included_budget_cents - v_row.included_spent_cents);
  v_remaining := greatest(0, v_included_left + v_row.prepaid_balance_cents - v_row.reserved_cents);

  return jsonb_build_object(
    'period_ym', v_row.period_ym,
    'included_budget_cents', v_row.included_budget_cents,
    'included_spent_cents', v_row.included_spent_cents,
    'prepaid_balance_cents', v_row.prepaid_balance_cents,
    'remaining_included_cents', v_included_left,
    'remaining_total_cents', v_remaining,
    'reserved_cents', v_row.reserved_cents,
    'last_debit_cents', v_row.last_debit_cents,
    'auto_recharge_enabled', v_row.auto_recharge_enabled,
    'auto_recharge_pack_cents', v_row.auto_recharge_pack_cents,
    'auto_recharge_last_error', v_row.auto_recharge_last_error
  );
end;
$$;

create or replace function public.rpc_begin_ai_turn(
  p_company_id uuid,
  p_hold_cents integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snap jsonb;
  v_available integer;
  v_last integer;
  v_need integer;
  v_hold public.company_ai_holds%rowtype;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return jsonb_build_object('allowed', false, 'reason', 'idempotency_required');
  end if;

  v_snap := public.rpc_ensure_ai_wallet(p_company_id);
  v_available := coalesce((v_snap->>'remaining_total_cents')::integer, 0);
  v_last := coalesce((v_snap->>'last_debit_cents')::integer, 0);
  v_need := greatest(1, coalesce(p_hold_cents, 1), case when v_last > 0 then v_last else 1 end);

  select * into v_hold
    from public.company_ai_holds
   where company_id = p_company_id
     and idempotency_key = p_idempotency_key;

  if v_hold.idempotency_key is not null then
    if v_hold.released_at is null then
      return jsonb_build_object('allowed', true, 'reused', true, 'hold_cents', v_hold.hold_cents);
    end if;
    return jsonb_build_object('allowed', false, 'reason', 'settled');
  end if;

  if v_available < v_need then
    return jsonb_build_object(
      'allowed', false,
      'reason', case when v_available <= 0 then 'empty' else 'below_last_debit' end,
      'available_cents', v_available,
      'need_cents', v_need
    );
  end if;

  begin
    insert into public.company_ai_holds (company_id, idempotency_key, hold_cents)
    values (p_company_id, p_idempotency_key, v_need);
  exception when unique_violation then
    return jsonb_build_object('allowed', true, 'reused', true, 'hold_cents', v_need);
  end;

  update public.company_ai_wallets
     set reserved_cents = reserved_cents + v_need,
         updated_at = now()
   where company_id = p_company_id;

  return jsonb_build_object('allowed', true, 'reused', false, 'hold_cents', v_need);
end;
$$;

create or replace function public.rpc_release_ai_turn(
  p_company_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold public.company_ai_holds%rowtype;
begin
  select * into v_hold
    from public.company_ai_holds
   where company_id = p_company_id
     and idempotency_key = p_idempotency_key
   for update;

  if v_hold.idempotency_key is null or v_hold.released_at is not null then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  update public.company_ai_wallets
     set reserved_cents = greatest(0, reserved_cents - v_hold.hold_cents),
         updated_at = now()
   where company_id = p_company_id;

  update public.company_ai_holds
     set released_at = now()
   where company_id = p_company_id
     and idempotency_key = p_idempotency_key;

  return jsonb_build_object('ok', true, 'released', true);
end;
$$;

create or replace function public.rpc_settle_ai_turn(
  p_company_id uuid,
  p_turn_key text,
  p_idempotency_key text,
  p_cost_cents integer,
  p_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold public.company_ai_holds%rowtype;
  v_row public.company_ai_wallets%rowtype;
  v_thread text;
  v_cost integer;
  v_included_left integer;
  v_available integer;
  v_charge integer;
  v_from_included integer;
  v_from_prepaid integer;
  v_dup uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_required');
  end if;

  select id into v_dup
    from public.company_ai_ledger
   where company_id = p_company_id
     and idempotency_key = p_idempotency_key;

  if v_dup is not null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into v_hold
    from public.company_ai_holds
   where company_id = p_company_id
     and idempotency_key = p_turn_key
   for update;

  if v_hold.idempotency_key is null then
    return jsonb_build_object('ok', false, 'reason', 'no_hold');
  end if;

  if v_hold.released_at is null then
    update public.company_ai_wallets
       set reserved_cents = greatest(0, reserved_cents - v_hold.hold_cents),
           updated_at = now()
     where company_id = p_company_id;
    update public.company_ai_holds
       set released_at = now()
     where company_id = p_company_id
       and idempotency_key = p_turn_key;
  end if;

  v_thread := nullif(trim(coalesce(p_meta->>'thread_id', '')), '');
  if v_thread is null then
    return jsonb_build_object('ok', false, 'reason', 'thread_required');
  end if;

  select * into v_row
    from public.company_ai_wallets
   where company_id = p_company_id
   for update;

  v_cost := least(500, greatest(0, coalesce(p_cost_cents, 0)));
  v_included_left := greatest(0, v_row.included_budget_cents - v_row.included_spent_cents);
  v_available := v_included_left + v_row.prepaid_balance_cents;
  v_charge := least(v_cost, greatest(0, v_available));

  if v_charge <= 0 then
    insert into public.company_ai_ledger (company_id, kind, amount_cents, idempotency_key, meta)
    values (
      p_company_id, 'included_debit', 0, p_idempotency_key,
      coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('thread_id', v_thread, 'charged_cents', 0)
    );
    return jsonb_build_object('ok', true, 'charged_cents', 0, 'exhausted', v_available <= 0);
  end if;

  v_from_included := least(v_charge, v_included_left);
  v_from_prepaid := v_charge - v_from_included;

  update public.company_ai_wallets
     set included_spent_cents = included_spent_cents + v_from_included,
         prepaid_balance_cents = prepaid_balance_cents - v_from_prepaid,
         last_debit_cents = v_charge,
         updated_at = now()
   where company_id = p_company_id;

  insert into public.company_ai_ledger (company_id, kind, amount_cents, idempotency_key, meta)
  values (
    p_company_id,
    case when v_from_included > 0 then 'included_debit' else 'prepaid_debit' end,
    -v_charge,
    p_idempotency_key,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
      'thread_id', v_thread,
      'from_included_cents', v_from_included,
      'from_prepaid_cents', v_from_prepaid,
      'charged_cents', v_charge
    )
  );

  return jsonb_build_object(
    'ok', true,
    'charged_cents', v_charge,
    'exhausted', (v_available - v_charge) <= 0
  );
end;
$$;

create or replace function public.rpc_credit_ai_pack(
  p_company_id uuid,
  p_pack_cents integer,
  p_pagarme_order_id text,
  p_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted boolean := false;
  v_order text := nullif(trim(coalesce(p_pagarme_order_id, '')), '');
begin
  if p_pack_cents not in (1000, 2000, 5000) then
    raise exception 'invalid_ai_pack';
  end if;

  perform public.rpc_ensure_ai_wallet(p_company_id);

  if v_order is not null then
    if exists (
      select 1 from public.company_ai_ledger
       where company_id = p_company_id
         and kind = 'pack_credit'
         and meta->>'pagarme_order_id' = v_order
    ) then
      return public.rpc_ensure_ai_wallet(p_company_id);
    end if;
  end if;

  begin
    insert into public.company_ai_ledger (company_id, kind, amount_cents, meta)
    values (
      p_company_id,
      'pack_credit',
      p_pack_cents,
      coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('pack_cents', p_pack_cents, 'pagarme_order_id', v_order)
    );
    v_inserted := true;
  exception when unique_violation then
    v_inserted := false;
  end;

  if not v_inserted then
    return public.rpc_ensure_ai_wallet(p_company_id);
  end if;

  update public.company_ai_wallets
     set prepaid_balance_cents = prepaid_balance_cents + p_pack_cents,
         auto_recharge_last_error = null,
         updated_at = now()
   where company_id = p_company_id;

  return public.rpc_ensure_ai_wallet(p_company_id);
end;
$$;

create or replace function public.rpc_set_ai_wallet_autorecharge(
  p_company_id uuid,
  p_enabled boolean,
  p_pack_cents integer,
  p_update_enabled boolean,
  p_update_pack boolean,
  p_last_error text,
  p_update_error boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.rpc_ensure_ai_wallet(p_company_id);

  if p_update_pack and p_pack_cents is not null and p_pack_cents not in (1000, 2000, 5000) then
    raise exception 'invalid_ai_pack';
  end if;

  update public.company_ai_wallets
     set auto_recharge_enabled = case when p_update_enabled then coalesce(p_enabled, false) else auto_recharge_enabled end,
         auto_recharge_pack_cents = case
           when p_update_pack then p_pack_cents
           else auto_recharge_pack_cents
         end,
         auto_recharge_last_error = case when p_update_error then p_last_error else auto_recharge_last_error end,
         updated_at = now()
   where company_id = p_company_id;

  return public.rpc_ensure_ai_wallet(p_company_id);
end;
$$;

create or replace function public.rpc_attribute_ai_order_usage(
  p_company_id uuid,
  p_order_id uuid,
  p_thread_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
  v_calls integer := 0;
  v_in integer := 0;
  v_out integer := 0;
  v_cache_read integer := 0;
  v_cache_write integer := 0;
  v_cost integer := 0;
  v_existing public.company_ai_order_usage%rowtype;
begin
  if not exists (
    select 1 from public.orders
     where id = p_order_id
       and company_id = p_company_id
       and source = 'ai_chat_pro_v2'
  ) then
    return jsonb_build_object('attributed', false, 'reason', 'not_ai_order');
  end if;

  select * into v_existing
    from public.company_ai_order_usage
   where order_id = p_order_id;

  if v_existing.order_id is not null then
    return jsonb_build_object('attributed', true, 'duplicate', true, 'order_id', p_order_id);
  end if;

  select max(created_at) into v_since
    from public.company_ai_order_usage
   where company_id = p_company_id
     and thread_id = p_thread_id;

  with claimed as (
    update public.company_ai_ledger
       set attributed_order_id = p_order_id
     where company_id = p_company_id
       and attributed_order_id is null
       and kind in ('included_debit', 'prepaid_debit')
       and amount_cents <> 0
       and meta->>'thread_id' = p_thread_id::text
       and created_at > coalesce(v_since, '-infinity'::timestamptz)
     returning
       coalesce((meta->>'input_tokens')::integer, 0) as input_tokens,
       coalesce((meta->>'output_tokens')::integer, 0) as output_tokens,
       coalesce((meta->>'cache_read_tokens')::integer, 0) as cache_read_tokens,
       coalesce((meta->>'cache_write_tokens')::integer, 0) as cache_write_tokens,
       abs(amount_cents) as cost_cents
  )
  select
    count(*)::integer,
    coalesce(sum(input_tokens), 0)::integer,
    coalesce(sum(output_tokens), 0)::integer,
    coalesce(sum(cache_read_tokens), 0)::integer,
    coalesce(sum(cache_write_tokens), 0)::integer,
    coalesce(sum(cost_cents), 0)::integer
  into v_calls, v_in, v_out, v_cache_read, v_cache_write, v_cost
  from claimed;

  begin
    insert into public.company_ai_order_usage (
      order_id, company_id, thread_id, call_count,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents
    ) values (
      p_order_id, p_company_id, p_thread_id, v_calls,
      v_in, v_out, v_cache_read, v_cache_write, v_cost
    );
  exception when unique_violation then
    return jsonb_build_object('attributed', true, 'duplicate', true, 'order_id', p_order_id);
  end;

  return jsonb_build_object(
    'attributed', true,
    'order_id', p_order_id,
    'call_count', v_calls,
    'input_tokens', v_in,
    'output_tokens', v_out,
    'cost_cents', v_cost
  );
end;
$$;

create or replace function public.rpc_ai_order_usage_average(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_calls numeric;
  v_in numeric;
  v_out numeric;
  v_cost numeric;
begin
  select
    count(*)::integer,
    avg(call_count),
    avg(input_tokens),
    avg(output_tokens),
    avg(cost_cents)
  into v_count, v_calls, v_in, v_out, v_cost
  from public.company_ai_order_usage
  where company_id = p_company_id;

  return jsonb_build_object(
    'order_count', coalesce(v_count, 0),
    'avg_calls', coalesce(round(v_calls, 2), 0),
    'avg_input_tokens', coalesce(round(v_in), 0),
    'avg_output_tokens', coalesce(round(v_out), 0),
    'avg_cost_cents', coalesce(round(v_cost), 0)
  );
end;
$$;

revoke all on function public.rpc_ensure_ai_wallet(uuid) from public, anon, authenticated;
revoke all on function public.rpc_begin_ai_turn(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.rpc_release_ai_turn(uuid, text) from public, anon, authenticated;
revoke all on function public.rpc_settle_ai_turn(uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_credit_ai_pack(uuid, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_set_ai_wallet_autorecharge(uuid, boolean, integer, boolean, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.rpc_attribute_ai_order_usage(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_ai_order_usage_average(uuid) from public, anon, authenticated;

grant execute on function public.rpc_ensure_ai_wallet(uuid) to service_role;
grant execute on function public.rpc_begin_ai_turn(uuid, integer, text) to service_role;
grant execute on function public.rpc_release_ai_turn(uuid, text) to service_role;
grant execute on function public.rpc_settle_ai_turn(uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.rpc_credit_ai_pack(uuid, integer, text, jsonb) to service_role;
grant execute on function public.rpc_set_ai_wallet_autorecharge(uuid, boolean, integer, boolean, boolean, text, boolean) to service_role;
grant execute on function public.rpc_attribute_ai_order_usage(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_ai_order_usage_average(uuid) to service_role;
