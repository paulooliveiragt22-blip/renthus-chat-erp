-- Taxas de serviço unificadas (entrega + garçom + couvert + …).
-- orders.delivery_fee = espelho da soma system_key=delivery (bridge bidirecional).
-- Conta 3.3 = taxas de serviço (não-entrega). Journal: 3.1 itens / 3.2 entrega / 3.3 serviço.

-- ─── Conta 3.3 ───────────────────────────────────────────────────────────────
insert into public.chart_of_accounts (id, company_id, code, name, type, is_system, is_active)
values (
  '00000000-0001-0000-0000-000000000303', null, '3.3', 'Taxas de serviço', 'revenue', true, true
)
on conflict (id) do update
  set code = excluded.code, name = excluded.name, is_active = true, is_system = true;

-- ─── Definições por empresa ──────────────────────────────────────────────────
create table public.service_fee_definitions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  slug            text not null,
  system_key      text check (system_key is null or system_key = any (array['delivery','service','other'])),
  calc_mode       text not null check (calc_mode = any (array['fixed','percent'])),
  value           numeric(14,4) not null check (value >= 0),
  is_active       boolean not null default true,
  sort_order      int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint service_fee_definitions_slug_uq unique (company_id, slug),
  constraint service_fee_definitions_percent_range check (
    calc_mode <> 'percent' or value <= 100
  )
);

create unique index service_fee_definitions_delivery_uq
  on public.service_fee_definitions (company_id)
  where system_key = 'delivery';

create index service_fee_definitions_company_idx
  on public.service_fee_definitions (company_id, is_active, sort_order);

alter table public.service_fee_definitions enable row level security;
alter table public.service_fee_definitions force row level security;
revoke all on table public.service_fee_definitions from anon, authenticated;
create policy rls_service_fee_definitions_service_role_only
  on public.service_fee_definitions
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ─── Linhas no pedido ────────────────────────────────────────────────────────
create table public.order_fees (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  order_id        uuid not null references public.orders(id) on delete cascade,
  definition_id   uuid references public.service_fee_definitions(id) on delete set null,
  name            text not null,
  system_key      text check (system_key is null or system_key = any (array['delivery','service','other'])),
  calc_mode       text not null check (calc_mode = any (array['fixed','percent'])),
  rate_or_amount  numeric(14,4) not null check (rate_or_amount >= 0),
  amount          numeric(14,2) not null check (amount >= 0),
  created_at      timestamptz not null default now()
);

create unique index order_fees_delivery_one_uq
  on public.order_fees (order_id)
  where system_key = 'delivery';

create index order_fees_order_idx on public.order_fees (order_id);
create index order_fees_company_idx on public.order_fees (company_id, order_id);

alter table public.order_fees enable row level security;
alter table public.order_fees force row level security;
revoke all on table public.order_fees from anon, authenticated;
create policy rls_order_fees_service_role_only
  on public.order_fees
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ─── Sync: order_fees → orders.delivery_fee ──────────────────────────────────
create or replace function public.fn_order_fees_sync_delivery_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid uuid;
  v_sum numeric;
begin
  v_oid := coalesce(NEW.order_id, OLD.order_id);
  select coalesce(sum(amount), 0) into v_sum
    from public.order_fees
   where order_id = v_oid and system_key = 'delivery';
  update public.orders
     set delivery_fee = v_sum
   where id = v_oid
     and delivery_fee is distinct from v_sum;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_order_fees_sync_delivery on public.order_fees;
create trigger trg_order_fees_sync_delivery
  after insert or update or delete on public.order_fees
  for each row execute function public.fn_order_fees_sync_delivery_fee();

-- ─── Bridge: writers legados que setam orders.delivery_fee → order_fees ──────
create or replace function public.fn_orders_delivery_fee_to_order_fees()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_def uuid;
  v_name text := 'Taxa de entrega';
  v_existing numeric;
  v_fee_id uuid;
begin
  if tg_op = 'UPDATE' and NEW.delivery_fee is not distinct from OLD.delivery_fee then
    return NEW;
  end if;

  select coalesce(sum(amount), 0) into v_existing
    from public.order_fees
   where order_id = NEW.id and system_key = 'delivery';

  if coalesce(NEW.delivery_fee, 0) is not distinct from v_existing then
    return NEW;
  end if;

  select id, name into v_def, v_name
    from public.service_fee_definitions
   where company_id = NEW.company_id and system_key = 'delivery' and is_active
   limit 1;

  if coalesce(NEW.delivery_fee, 0) <= 0 then
    delete from public.order_fees
     where order_id = NEW.id and system_key = 'delivery';
    return NEW;
  end if;

  select id into v_fee_id
    from public.order_fees
   where order_id = NEW.id and system_key = 'delivery'
   limit 1;

  if v_fee_id is null then
    insert into public.order_fees (
      company_id, order_id, definition_id, name, system_key, calc_mode, rate_or_amount, amount
    ) values (
      NEW.company_id, NEW.id, v_def, coalesce(v_name, 'Taxa de entrega'),
      'delivery', 'fixed', coalesce(NEW.delivery_fee, 0), coalesce(NEW.delivery_fee, 0)
    );
  else
    update public.order_fees
       set amount = coalesce(NEW.delivery_fee, 0),
           rate_or_amount = coalesce(NEW.delivery_fee, 0),
           name = coalesce(v_name, name),
           definition_id = coalesce(v_def, definition_id)
     where id = v_fee_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_orders_delivery_fee_bridge on public.orders;
create trigger trg_orders_delivery_fee_bridge
  after insert or update of delivery_fee on public.orders
  for each row execute function public.fn_orders_delivery_fee_to_order_fees();

revoke all on function public.fn_order_fees_sync_delivery_fee() from public;
revoke all on function public.fn_orders_delivery_fee_to_order_fees() from public;

-- ─── Seed: Taxa de entrega por empresa ───────────────────────────────────────
insert into public.service_fee_definitions (
  company_id, name, slug, system_key, calc_mode, value, is_active, sort_order
)
select
  c.id,
  'Taxa de entrega',
  'taxa-de-entrega',
  'delivery',
  'fixed',
  coalesce(c.default_delivery_fee, 0),
  true,
  10
from public.companies c
on conflict (company_id, slug) do nothing;

-- Backfill order_fees a partir de delivery_fee existente
insert into public.order_fees (
  company_id, order_id, definition_id, name, system_key, calc_mode, rate_or_amount, amount
)
select
  o.company_id,
  o.id,
  d.id,
  coalesce(d.name, 'Taxa de entrega'),
  'delivery',
  'fixed',
  o.delivery_fee,
  o.delivery_fee
from public.orders o
left join public.service_fee_definitions d
  on d.company_id = o.company_id and d.system_key = 'delivery'
where coalesce(o.delivery_fee, 0) > 0
  and not exists (
    select 1 from public.order_fees f
     where f.order_id = o.id and f.system_key = 'delivery'
  );

-- ─── Helper: créditos 3.1 / 3.2 / 3.3 ─────────────────────────────────────────
create or replace function public.fn_fin_build_sale_credit_lines(
  p_company_id uuid,
  p_order_id uuid,
  p_gross numeric,
  p_debit_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery numeric := 0;
  v_service numeric := 0;
  v_items numeric;
  v_lines jsonb;
begin
  if p_order_id is not null then
    select coalesce(sum(amount) filter (where system_key = 'delivery'), 0),
           coalesce(sum(amount) filter (where system_key is distinct from 'delivery'), 0)
      into v_delivery, v_service
      from public.order_fees
     where order_id = p_order_id and company_id = p_company_id;
  end if;

  if v_delivery = 0 and p_order_id is not null then
    select coalesce(delivery_fee, 0) into v_delivery
      from public.orders where id = p_order_id and company_id = p_company_id;
  end if;

  if v_delivery + v_service > p_gross then
    v_delivery := 0;
    v_service := 0;
  end if;

  v_items := p_gross - v_delivery - v_service;
  if v_items < 0 then v_items := 0; end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('code', p_debit_code, 'dir', 'debit', 'amt', p_gross)
  );
  if v_items > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('code', '3.1', 'dir', 'credit', 'amt', v_items)
    );
  end if;
  if v_delivery > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('code', '3.2', 'dir', 'credit', 'amt', v_delivery)
    );
  end if;
  if v_service > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('code', '3.3', 'dir', 'credit', 'amt', v_service)
    );
  end if;
  if jsonb_array_length(v_lines) = 1 and p_gross > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('code', p_debit_code, 'dir', 'debit', 'amt', p_gross),
      jsonb_build_object('code', '3.1', 'dir', 'credit', 'amt', p_gross)
    );
  end if;
  return v_lines;
end;
$$;

revoke all on function public.fn_fin_build_sale_credit_lines(uuid, uuid, numeric, text) from public;
revoke all on function public.fn_fin_build_sale_credit_lines(uuid, uuid, numeric, text) from anon, authenticated;
grant execute on function public.fn_fin_build_sale_credit_lines(uuid, uuid, numeric, text) to service_role;

-- ─── PDV post: split 3.1 / 3.2 / 3.3 ──────────────────────────────────────────
create or replace function public.fn_fin_post_sale_payments(
  p_company_id uuid,
  p_sale_id uuid,
  p_order_id uuid,
  p_origin text,
  p_cash_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_prazo boolean;
  v_i int := 0;
  v_key text;
  v_lines jsonb;
  v_orig text := public.fn_fin_map_origin(p_origin);
  v_fee_delivery numeric := 0;
  v_fee_service numeric := 0;
  v_fee_left_d numeric;
  v_fee_left_s numeric;
  v_take_d numeric;
  v_take_s numeric;
  v_items numeric;
  v_debit text;
  v_sale_fee numeric := 0;
begin
  select coalesce(s.delivery_fee, 0) into v_sale_fee
    from public.sales s
   where s.id = p_sale_id and s.company_id = p_company_id;

  if p_order_id is not null then
    select coalesce(sum(amount) filter (where system_key = 'delivery'), 0),
           coalesce(sum(amount) filter (where system_key is distinct from 'delivery'), 0)
      into v_fee_delivery, v_fee_service
      from public.order_fees
     where order_id = p_order_id and company_id = p_company_id;
    if v_fee_delivery = 0 then
      select coalesce(delivery_fee, 0) into v_fee_delivery
        from public.orders where id = p_order_id and company_id = p_company_id;
    end if;
  end if;

  if v_fee_delivery = 0 then
    v_fee_delivery := coalesce(v_sale_fee, 0);
  elsif coalesce(v_sale_fee, 0) = 0 then
    update public.sales
       set delivery_fee = v_fee_delivery
     where id = p_sale_id and company_id = p_company_id;
  end if;

  v_fee_left_d := v_fee_delivery;
  v_fee_left_s := v_fee_service;

  for r in
    select sp.id, sp.payment_method, sp.amount
      from public.sale_payments sp
     where sp.sale_id = p_sale_id and sp.company_id = p_company_id
     order by sp.created_at, sp.id
  loop
    v_i := v_i + 1;
    v_prazo := public.fn_fin_is_prazo(r.payment_method);
    v_debit := case when v_prazo then '1.2' else '1.1' end;
    v_key := 'sale:' || p_sale_id::text || ':pay:' || v_i::text;

    v_take_d := least(v_fee_left_d, r.amount);
    v_take_s := least(v_fee_left_s, r.amount - v_take_d);
    v_items := r.amount - v_take_d - v_take_s;
    v_fee_left_d := v_fee_left_d - v_take_d;
    v_fee_left_s := v_fee_left_s - v_take_s;

    v_lines := jsonb_build_array(
      jsonb_build_object('code', v_debit, 'dir', 'debit', 'amt', r.amount)
    );
    if v_items > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','3.1','dir','credit','amt', v_items));
    end if;
    if v_take_d > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','3.2','dir','credit','amt', v_take_d));
    end if;
    if v_take_s > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','3.3','dir','credit','amt', v_take_s));
    end if;
    if jsonb_array_length(v_lines) = 1 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('code','3.1','dir','credit','amt', r.amount));
    end if;

    perform public.fn_fin_post_journal(
      p_company_id, v_key, 'sale_payment', r.id,
      p_sale_id, p_order_id, null, p_cash_id, r.id,
      v_orig, r.payment_method, now(), now(), null, null, 'Venda', null, v_lines
    );
  end loop;
end;
$$;

revoke all on function public.fn_fin_post_sale_payments(uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.fn_fin_post_sale_payments(uuid, uuid, uuid, text, uuid) from anon, authenticated;
grant execute on function public.fn_fin_post_sale_payments(uuid, uuid, uuid, text, uuid) to service_role;

-- ─── Recognize: usa helper 3.1/3.2/3.3 (corpo alinhado ao F2) ─────────────────
create or replace function public.rpc_recognize_order_sale(
  p_company_id uuid,
  p_order_id uuid,
  p_idempotency_key text default null,
  p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders%rowtype;
  v_key text;
  v_pm text;
  v_sale uuid;
  v_pay uuid;
  v_jid uuid;
  v_existing uuid;
  v_lines jsonb;
  v_gross numeric;
  v_origin text;
  v_prazo boolean;
  v_due date;
  v_debit text;
begin
  select * into v_o from public.orders
   where id = p_order_id and company_id = p_company_id for update;
  if not found then
    raise exception 'pedido não encontrado' using errcode = 'no_data_found';
  end if;

  v_key := coalesce(nullif(trim(coalesce(p_idempotency_key, '')), ''), 'order:' || p_order_id::text || ':recognize');
  select id into v_existing from public.finance_journals
   where company_id = p_company_id and idempotency_key = v_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'sale_id', v_o.sale_id, 'journal_id', v_existing, 'idempotent', true);
  end if;

  if v_o.sale_id is not null then
    return jsonb_build_object('ok', true, 'sale_id', v_o.sale_id, 'skipped', 'has_sale');
  end if;

  v_pm := coalesce(public.fn_fin_map_payment_method(v_o.payment_method), 'pix');
  v_origin := public.fn_fin_map_origin(v_o.source);
  v_prazo := public.fn_fin_is_prazo(v_pm);

  if v_prazo then
    if v_origin in ('chatbot', 'web_menu', 'ai_chat', 'table_service') then
      raise exception 'chatbot_prazo_forbidden' using errcode = '23514';
    end if;
    if v_o.customer_id is null then
      raise exception 'customer_required_for_prazo' using errcode = '23502';
    end if;
  end if;

  v_gross := coalesce(v_o.total_amount, v_o.total, 0);
  insert into public.sales (
    company_id, order_id, customer_id, origin, subtotal, delivery_fee, total, status, sold_at
  ) values (
    p_company_id, p_order_id, v_o.customer_id,
    v_origin,
    coalesce(v_o.total, v_gross, 0),
    coalesce(v_o.delivery_fee, 0),
    v_gross,
    case when v_prazo then 'partial'::text else 'paid'::text end,
    now()
  ) returning id into v_sale;

  insert into public.sale_items (
    sale_id, company_id, produto_embalagem_id, product_name, qty, unit_price, unit_cost
  )
  select
    v_sale, p_company_id, oi.produto_embalagem_id, coalesce(oi.product_name, 'Item'),
    coalesce(oi.qty, oi.quantity, 1),
    coalesce(oi.unit_price, 0),
    coalesce((
      select coalesce(p.preco_custo_unitario, 0) * coalesce(pe.fator_conversao, 1)
        from public.produto_embalagens pe
        join public.products p on p.id = pe.produto_id
       where pe.id = oi.produto_embalagem_id
    ), 0)
  from public.order_items oi
  where oi.order_id = p_order_id;

  v_due := coalesce(p_due_date, case when v_prazo then (current_date + 30) else current_date end);

  insert into public.sale_payments (sale_id, company_id, payment_method, amount, due_date)
  values (v_sale, p_company_id, v_pm, v_gross, v_due)
  returning id into v_pay;

  update public.orders
     set sale_id = v_sale, paid = not v_prazo
   where id = p_order_id and company_id = p_company_id;

  if v_gross <= 0 then
    return jsonb_build_object('ok', true, 'sale_id', v_sale, 'journal_id', null);
  end if;

  v_debit := case when v_prazo then '1.2' else '1.1' end;
  v_lines := public.fn_fin_build_sale_credit_lines(p_company_id, p_order_id, v_gross, v_debit);

  v_jid := public.fn_fin_post_journal(
    p_company_id, v_key, 'recognize', p_order_id,
    v_sale, p_order_id, null, null, v_pay,
    v_origin, v_pm, now(), now(), null, null,
    case when v_prazo then 'Pedido a prazo' else 'Pedido liquidado' end,
    null, v_lines
  );

  return jsonb_build_object('ok', true, 'sale_id', v_sale, 'journal_id', v_jid, 'prazo', v_prazo);
end;
$$;

revoke all on function public.rpc_recognize_order_sale(uuid, uuid, text, date) from public;
revoke all on function public.rpc_recognize_order_sale(uuid, uuid, text, date) from anon, authenticated;
grant execute on function public.rpc_recognize_order_sale(uuid, uuid, text, date) to service_role;

-- ─── RPC upsert definição ────────────────────────────────────────────────────
create or replace function public.rpc_upsert_service_fee_definition(
  p_company_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_name text;
  v_slug text;
  v_key text;
  v_mode text;
  v_value numeric;
  v_active boolean;
  v_sort int;
begin
  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;
  v_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  v_slug := nullif(trim(coalesce(p_payload ->> 'slug', '')), '');
  v_key := nullif(trim(coalesce(p_payload ->> 'system_key', '')), '');
  v_mode := coalesce(nullif(trim(p_payload ->> 'calc_mode'), ''), 'fixed');
  v_value := coalesce((p_payload ->> 'value')::numeric, 0);
  v_active := coalesce((p_payload ->> 'is_active')::boolean, true);
  v_sort := coalesce((p_payload ->> 'sort_order')::int, 100);

  if v_name is null then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if v_slug is null then
    v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then
      v_slug := 'taxa-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    end if;
  end if;
  if v_mode not in ('fixed', 'percent') then
    raise exception 'invalid_calc_mode' using errcode = '22023';
  end if;
  if v_key is not null and v_key not in ('delivery', 'service', 'other') then
    raise exception 'invalid_system_key' using errcode = '22023';
  end if;
  if v_mode = 'percent' and v_value > 100 then
    raise exception 'percent_out_of_range' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.service_fee_definitions (
      company_id, name, slug, system_key, calc_mode, value, is_active, sort_order
    ) values (
      p_company_id, v_name, v_slug, v_key, v_mode, v_value, v_active, v_sort
    )
    returning id into v_id;
  else
    update public.service_fee_definitions
       set name = v_name,
           slug = v_slug,
           system_key = v_key,
           calc_mode = v_mode,
           value = v_value,
           is_active = v_active,
           sort_order = v_sort,
           updated_at = now()
     where id = v_id and company_id = p_company_id
    returning id into v_id;
    if v_id is null then
      raise exception 'fee_not_found' using errcode = 'P0002';
    end if;
  end if;

  if v_key = 'delivery' and v_mode = 'fixed' then
    update public.companies
       set default_delivery_fee = v_value
     where id = p_company_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.rpc_upsert_service_fee_definition(uuid, jsonb) from public;
revoke all on function public.rpc_upsert_service_fee_definition(uuid, jsonb) from anon, authenticated;
grant execute on function public.rpc_upsert_service_fee_definition(uuid, jsonb) to service_role;

-- ─── RPC aplicar taxas no pedido (% sobre subtotal de itens) ─────────────────
create or replace function public.rpc_apply_order_fees(
  p_company_id uuid,
  p_order_id uuid,
  p_fees jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric := 0;
  r jsonb;
  v_def uuid;
  v_name text;
  v_key text;
  v_mode text;
  v_rate numeric;
  v_amt numeric;
  v_row record;
begin
  if not exists (
    select 1 from public.orders where id = p_order_id and company_id = p_company_id
  ) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(coalesce(oi.line_total, coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0))), 0)
    into v_subtotal
    from public.order_items oi
   where oi.order_id = p_order_id;

  delete from public.order_fees
   where order_id = p_order_id
     and company_id = p_company_id
     and system_key is distinct from 'delivery';

  for r in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb))
  loop
    v_def := nullif(trim(coalesce(r ->> 'definition_id', '')), '')::uuid;
    v_name := nullif(trim(coalesce(r ->> 'name', '')), '');
    v_key := nullif(trim(coalesce(r ->> 'system_key', '')), '');
    v_mode := coalesce(nullif(trim(r ->> 'calc_mode'), ''), 'fixed');
    v_rate := coalesce((r ->> 'rate_or_amount')::numeric, (r ->> 'value')::numeric, 0);

    if v_def is not null then
      select d.name, d.system_key, d.calc_mode, d.value
        into v_row
        from public.service_fee_definitions d
       where d.id = v_def and d.company_id = p_company_id;
      if found then
        v_name := coalesce(v_name, v_row.name);
        v_key := coalesce(v_key, v_row.system_key);
        v_mode := coalesce(nullif(trim(r ->> 'calc_mode'), ''), v_row.calc_mode, 'fixed');
        if (r ->> 'rate_or_amount') is null and (r ->> 'value') is null then
          v_rate := v_row.value;
        end if;
      end if;
    end if;

    if v_name is null then
      continue;
    end if;
    if v_mode = 'percent' then
      v_amt := round(v_subtotal * v_rate / 100.0, 2);
    else
      v_amt := round(v_rate, 2);
    end if;
    if v_amt < 0 then v_amt := 0; end if;

    if v_key = 'delivery' then
      delete from public.order_fees
       where order_id = p_order_id and system_key = 'delivery';
    end if;

    if v_amt = 0 then
      continue;
    end if;

    insert into public.order_fees (
      company_id, order_id, definition_id, name, system_key, calc_mode, rate_or_amount, amount
    ) values (
      p_company_id, p_order_id, v_def, v_name, v_key, v_mode, v_rate, v_amt
    );
  end loop;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'name', f.name,
      'system_key', f.system_key,
      'calc_mode', f.calc_mode,
      'rate_or_amount', f.rate_or_amount,
      'amount', f.amount
    ) order by f.created_at), '[]'::jsonb)
    from public.order_fees f
    where f.order_id = p_order_id and f.company_id = p_company_id
  );
end;
$$;

revoke all on function public.rpc_apply_order_fees(uuid, uuid, jsonb) from public;
revoke all on function public.rpc_apply_order_fees(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.rpc_apply_order_fees(uuid, uuid, jsonb) to service_role;
