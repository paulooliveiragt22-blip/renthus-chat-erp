-- Mesa ADR 0017: pedido consuming, estoque no lançamento, garçom libera, caixa confirma.

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status = any (array['new','preparing','delivered','finalized','canceled','consuming']));

alter table public.table_sessions drop constraint if exists table_sessions_status_check;
alter table public.table_sessions
  add constraint table_sessions_status_check
  check (status = any (array['open','released','closed','cancelled']));

alter table public.table_sessions
  add column if not exists released_table_code text;

create table if not exists public.table_session_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  amount numeric(15,2) not null check (amount > 0),
  payment_method text not null check (payment_method = any (array['cash','pix','debit','card'])),
  status text not null default 'draft' check (status = any (array['draft','posted'])),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists table_session_payments_company_idx
  on public.table_session_payments (company_id);
create index if not exists table_session_payments_session_idx
  on public.table_session_payments (session_id);

alter table public.table_session_payments enable row level security;
alter table public.table_session_payments force row level security;
revoke all on table public.table_session_payments from anon, authenticated;
drop policy if exists rls_table_session_payments_service_role_only on public.table_session_payments;
create policy rls_table_session_payments_service_role_only on public.table_session_payments
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.mesa_launch_keys (
  company_id uuid not null,
  idempotency_key text not null,
  session_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, idempotency_key)
);

create index if not exists mesa_launch_keys_company_idx
  on public.mesa_launch_keys (company_id);

alter table public.mesa_launch_keys enable row level security;
alter table public.mesa_launch_keys force row level security;
revoke all on table public.mesa_launch_keys from anon, authenticated;
drop policy if exists rls_mesa_launch_keys_service_role_only on public.mesa_launch_keys;
create policy rls_mesa_launch_keys_service_role_only on public.mesa_launch_keys
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.fn_mesa_assert_stock(p_embalagem_id uuid, p_extra_qty numeric)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_fator numeric;
  v_volume uuid;
  v_produto uuid;
  v_zero boolean;
  v_estoque numeric;
  v_disp numeric;
begin
  if p_embalagem_id is null or coalesce(p_extra_qty, 0) <= 0 then
    return;
  end if;
  select pe.fator_conversao, pe.product_volume_id, pe.produto_id, coalesce(p.vender_com_estoque_zero, true)
    into v_fator, v_volume, v_produto, v_zero
    from public.produto_embalagens pe
    join public.products p on p.id = pe.produto_id
   where pe.id = p_embalagem_id;
  if v_zero then
    return;
  end if;
  v_fator := greatest(coalesce(v_fator, 1), 0.0001);
  if v_volume is not null then
    select pv.estoque_atual into v_estoque from public.product_volumes pv where pv.id = v_volume;
  else
    select pv.estoque_atual into v_estoque
      from public.product_volumes pv
     where pv.product_id = v_produto
     order by pv.volume_quantidade nulls last
     limit 1;
  end if;
  v_disp := floor(coalesce(v_estoque, 0) / v_fator);
  if v_disp < p_extra_qty then
    raise exception 'sem_estoque' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.fn_mesa_assert_stock(uuid, numeric) from public, anon, authenticated;
grant execute on function public.fn_mesa_assert_stock(uuid, numeric) to service_role;

create or replace function public.fn_mesa_refresh_due(p_company_id uuid, p_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_items numeric := 0;
  v_fee numeric := 0;
  r record;
  v_amt numeric;
begin
  select coalesce(sum(coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0)), 0)
    into v_items
    from public.order_items oi
   where oi.order_id = p_order_id and oi.company_id = p_company_id;

  update public.orders
     set total = round(v_items, 2)
   where id = p_order_id and company_id = p_company_id;

  delete from public.order_fees
   where order_id = p_order_id
     and company_id = p_company_id
     and system_key = 'service';

  for r in
    select d.id, d.name, d.calc_mode, d.value
      from public.service_fee_definitions d
     where d.company_id = p_company_id
       and d.is_active
       and d.system_key = 'service'
  loop
    if r.calc_mode = 'percent' then
      v_amt := round(v_items * coalesce(r.value, 0) / 100.0, 2);
    else
      v_amt := round(coalesce(r.value, 0), 2);
    end if;
    if v_amt > 0 then
      insert into public.order_fees (
        company_id, order_id, definition_id, name, system_key, calc_mode, rate_or_amount, amount
      ) values (
        p_company_id, p_order_id, r.id, r.name, 'service', coalesce(r.calc_mode, 'fixed'), r.value, v_amt
      );
      v_fee := v_fee + v_amt;
    end if;
  end loop;

  return round(v_items + v_fee, 2);
end;
$$;

revoke all on function public.fn_mesa_refresh_due(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mesa_refresh_due(uuid, uuid) to service_role;

create or replace function public.fn_mesa_replace_parts(
  p_company_id uuid,
  p_session_id uuid,
  p_parts jsonb,
  p_due numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sum numeric := 0;
  v_i int := 0;
  r jsonb;
  v_method text;
  v_amount numeric;
begin
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    raise exception 'payments_required' using errcode = '23502';
  end if;

  delete from public.table_session_payments
   where session_id = p_session_id
     and company_id = p_company_id
     and status = 'draft';

  for r in select value from jsonb_array_elements(p_parts)
  loop
    v_method := lower(trim(coalesce(r ->> 'method', r ->> 'payment_method', '')));
    if v_method = any (array['credit_installment','boleto','promissoria','cheque','credit']) then
      raise exception 'payment_not_allowed' using errcode = '23514';
    end if;
    if v_method <> all (array['cash','pix','debit','card']) then
      raise exception 'payment_not_allowed' using errcode = '23514';
    end if;
    v_amount := round(coalesce((r ->> 'amount')::numeric, (r ->> 'value')::numeric, 0), 2);
    if v_amount <= 0 then
      raise exception 'payment_amount_invalid' using errcode = '23514';
    end if;
    v_i := v_i + 1;
    insert into public.table_session_payments (company_id, session_id, amount, payment_method, status, sort_order)
    values (p_company_id, p_session_id, v_amount, v_method, 'draft', v_i);
    v_sum := v_sum + v_amount;
  end loop;

  if round(v_sum, 2) <> round(p_due, 2) then
    raise exception 'payments_mismatch' using errcode = '23514';
  end if;
  return round(v_sum, 2);
end;
$$;

revoke all on function public.fn_mesa_replace_parts(uuid, uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.fn_mesa_replace_parts(uuid, uuid, jsonb, numeric) to service_role;

-- Abrir mesa confirma o pedido na hora. Sem este filtro, a cozinha imprime comanda vazia.
create or replace function public.enqueue_print_job_for_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_auto   boolean;
    v_copies text[];
    v_result jsonb;
begin
    if new.company_id is null then
        return new;
    end if;

    if coalesce(new.confirmation_status, '') <> 'confirmed' then
        return new;
    end if;

    if new.status = 'consuming' then
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if coalesce(old.confirmation_status, '') = 'confirmed' then
            return new;
        end if;
    end if;

    if new.printed_at is not null then
        return new;
    end if;

    select coalesce(cs.auto_print_orders, true),
           coalesce(cs.print_auto_copies, array['kitchen', 'cashier', 'driver']::text[])
      into v_auto, v_copies
      from public.company_settings cs
     where cs.company_id = new.company_id;

    if not coalesce(v_auto, true) then
        return new;
    end if;

    if v_copies is null or cardinality(v_copies) = 0 then
        return new;
    end if;

    begin
        v_result := public.rpc_enqueue_print_job(
            new.company_id,
            new.id,
            'order',
            0,
            100,
            v_copies
        );
    exception
        when others then
            raise warning 'enqueue_print_job_for_order: %', sqlerrm;
    end;

    return new;
end;
$$;

-- Comandas abertas existentes viram pedido consuming antes de dropar table_session_items.
do $$
declare
  s record;
  v_order uuid;
  v_items numeric;
begin
  for s in
    select ts.id, ts.company_id, ts.customer_id, ts.dining_table_id, dt.code
      from public.table_sessions ts
      join public.dining_tables dt on dt.id = ts.dining_table_id
     where ts.status = 'open' and ts.order_id is null
  loop
    insert into public.orders (
      company_id, source, channel, status, confirmation_status, confirmed_at,
      customer_id, customer_name, total, paid, delivery_fee, fulfillment_type,
      table_session_id, payment_method
    ) values (
      s.company_id, 'table_service', 'mesa', 'consuming', 'confirmed', now(),
      s.customer_id, 'Mesa ' || s.code, 0, false, 0, 'pickup',
      s.id, 'pix'
    ) returning id into v_order;

    insert into public.order_items (
      company_id, order_id, product_id, produto_embalagem_id, product_name,
      quantity, qty, unit_type, unit_price, combo_id, promocao_id, combo_label
    )
    select
      i.company_id, v_order, i.product_id, i.produto_embalagem_id, coalesce(i.product_name, ''),
      greatest(1, trunc(i.qty)::integer), i.qty,
      case when upper(coalesce(i.sigla_comercial, '')) = 'CX' then 'case' else 'unit' end,
      i.unit_price, i.combo_id, i.promocao_id, i.combo_label
      from public.table_session_items i
     where i.session_id = s.id;

    select coalesce(sum(coalesce(oi.qty, 0) * coalesce(oi.unit_price, 0)), 0)
      into v_items
      from public.order_items oi
     where oi.order_id = v_order;

    update public.orders set total = round(v_items, 2) where id = v_order;
    update public.table_sessions set order_id = v_order where id = s.id;
  end loop;
end;
$$;

create or replace function public.rpc_mesa_list_floor(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sort_order, t.code), '[]'::jsonb)
    into v_result
    from (
      select
        dt.id,
        dt.code,
        dt.label,
        dt.capacity,
        dt.sort_order,
        dt.status as table_status,
        s.id as session_id,
        s.opened_at,
        s.notes,
        s.customer_id,
        coalesce((
          select sum(coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0))
            from public.order_items oi
           where oi.order_id = s.order_id
        ), 0) as session_total,
        coalesce((
          select count(*)::int from public.order_items oi where oi.order_id = s.order_id
        ), 0) as items_count
      from public.dining_tables dt
      left join public.table_sessions s
        on s.dining_table_id = dt.id and s.status = 'open' and s.company_id = dt.company_id
      where dt.company_id = p_company_id
    ) t;
  return jsonb_build_object('ok', true, 'tables', v_result);
end;
$$;

create or replace function public.rpc_mesa_open_session(
  p_company_id uuid,
  p_table_id uuid,
  p_notes text default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table public.dining_tables%rowtype;
  v_session public.table_sessions%rowtype;
  v_order uuid;
  v_name text;
begin
  select * into v_table
    from public.dining_tables
   where id = p_table_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  if v_table.status = 'disabled' then
    raise exception 'table_disabled' using errcode = '23514';
  end if;
  if v_table.status = 'occupied' or exists (
    select 1 from public.table_sessions
     where dining_table_id = p_table_id and status = 'open'
  ) then
    raise exception 'table_already_open' using errcode = '23505';
  end if;

  v_name := 'Mesa ' || v_table.code;
  insert into public.table_sessions (company_id, dining_table_id, notes, customer_id)
  values (p_company_id, p_table_id, nullif(trim(coalesce(p_notes, '')), ''), p_customer_id)
  returning * into v_session;

  insert into public.orders (
    company_id, source, channel, status, confirmation_status, confirmed_at,
    customer_id, customer_name, total, paid, delivery_fee, fulfillment_type,
    table_session_id, payment_method
  ) values (
    p_company_id, 'table_service', 'mesa', 'consuming', 'confirmed', now(),
    p_customer_id, v_name, 0, false, 0, 'pickup',
    v_session.id, 'pix'
  ) returning id into v_order;

  update public.table_sessions set order_id = v_order where id = v_session.id;
  update public.dining_tables set status = 'occupied', updated_at = now() where id = p_table_id;

  return jsonb_build_object('ok', true, 'session', jsonb_build_object(
    'id', v_session.id,
    'order_id', v_order,
    'dining_table_id', v_session.dining_table_id,
    'opened_at', v_session.opened_at,
    'notes', v_session.notes
  ));
end;
$$;

create or replace function public.rpc_mesa_add_item(
  p_company_id uuid,
  p_session_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_sessions%rowtype;
  v_key text := nullif(trim(coalesce(p_payload ->> 'idempotency_key', '')), '');
  v_lines jsonb;
  v_line jsonb;
  v_qty numeric := coalesce((p_payload ->> 'qty')::numeric, (p_payload ->> 'quantity')::numeric, 1);
begin
  if v_key is not null then
    insert into public.mesa_launch_keys (company_id, idempotency_key, session_id)
    values (p_company_id, v_key, p_session_id)
    on conflict (company_id, idempotency_key) do nothing;
    if not found then
      return jsonb_build_object('ok', true, 'replay', true);
    end if;
  end if;

  select * into v_session
    from public.table_sessions
   where id = p_session_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '23514';
  end if;
  if v_session.order_id is null then
    raise exception 'order_missing' using errcode = 'P0002';
  end if;

  v_lines := public.fn_expand_sale_lines(
    p_company_id,
    jsonb_build_array(jsonb_build_object(
      'produto_embalagem_id', p_payload ->> 'produto_embalagem_id',
      'combo_id', p_payload ->> 'combo_id',
      'quantity', greatest(1, trunc(v_qty)::integer)
    )),
    false
  );

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    perform public.fn_mesa_assert_stock(
      nullif(v_line ->> 'produto_embalagem_id', '')::uuid,
      coalesce((v_line ->> 'quantity')::numeric, 1)
    );
    insert into public.order_items (
      company_id, order_id, product_id, produto_embalagem_id, product_name,
      quantity, qty, unit_type, unit_price, combo_id, promocao_id, combo_label
    ) values (
      p_company_id,
      v_session.order_id,
      nullif(v_line ->> 'produto_id', '')::uuid,
      nullif(v_line ->> 'produto_embalagem_id', '')::uuid,
      coalesce(v_line ->> 'product_name', ''),
      greatest(1, trunc(coalesce((v_line ->> 'quantity')::numeric, 1))::integer),
      coalesce((v_line ->> 'quantity')::numeric, 1),
      coalesce(v_line ->> 'unit_type', 'unit'),
      coalesce((v_line ->> 'unit_price')::numeric, 0),
      nullif(v_line ->> 'combo_id', '')::uuid,
      nullif(v_line ->> 'promocao_id', '')::uuid,
      nullif(v_line ->> 'combo_label', '')
    );
  end loop;

  perform public.fn_mesa_refresh_due(p_company_id, v_session.order_id);
  return jsonb_build_object('ok', true, 'lines', v_lines);
end;
$$;

create or replace function public.rpc_mesa_set_item_qty(
  p_company_id uuid,
  p_session_id uuid,
  p_item_id uuid,
  p_qty numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_sessions%rowtype;
  v_old numeric;
  v_emb uuid;
begin
  select * into v_session
    from public.table_sessions
   where id = p_session_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '23514';
  end if;

  if p_qty is null or p_qty <= 0 then
    delete from public.order_items
     where id = p_item_id and order_id = v_session.order_id and company_id = p_company_id;
  else
    select qty, produto_embalagem_id into v_old, v_emb
      from public.order_items
     where id = p_item_id and order_id = v_session.order_id and company_id = p_company_id
     for update;
    if not found then
      raise exception 'item_not_found' using errcode = 'P0002';
    end if;
    if p_qty > coalesce(v_old, 0) then
      perform public.fn_mesa_assert_stock(v_emb, p_qty - coalesce(v_old, 0));
    end if;
    update public.order_items
       set qty = p_qty,
           quantity = greatest(1, trunc(p_qty)::integer)
     where id = p_item_id;
  end if;

  perform public.fn_mesa_refresh_due(p_company_id, v_session.order_id);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.rpc_mesa_remove_item(
  p_company_id uuid,
  p_session_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.rpc_mesa_set_item_qty(p_company_id, p_session_id, p_item_id, 0);
end;
$$;

create or replace function public.rpc_mesa_get_session(p_company_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_sessions%rowtype;
  v_table public.dining_tables%rowtype;
  v_items jsonb;
  v_due numeric := 0;
begin
  select * into v_session
    from public.table_sessions
   where id = p_session_id and company_id = p_company_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  select * into v_table from public.dining_tables where id = v_session.dining_table_id;

  if v_session.status = 'open' and v_session.order_id is not null then
    v_due := public.fn_mesa_refresh_due(p_company_id, v_session.order_id);
  elsif v_session.order_id is not null then
    select coalesce(o.total_amount, o.total, 0) into v_due
      from public.orders o where o.id = v_session.order_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', oi.id,
    'produto_embalagem_id', oi.produto_embalagem_id,
    'product_id', oi.product_id,
    'product_name', oi.product_name,
    'qty', oi.qty,
    'unit_price', oi.unit_price,
    'sigla_comercial', case when oi.unit_type = 'case' then 'CX' else 'UN' end,
    'combo_id', oi.combo_id,
    'combo_label', oi.combo_label
  ) order by oi.created_at desc nulls last, oi.id), '[]'::jsonb)
    into v_items
    from public.order_items oi
   where oi.order_id = v_session.order_id;

  return jsonb_build_object('ok', true, 'session', jsonb_build_object(
    'id', v_session.id,
    'status', v_session.status,
    'order_id', v_session.order_id,
    'total', v_due,
    'notes', v_session.notes,
    'customer_id', v_session.customer_id,
    'table', jsonb_build_object('id', v_table.id, 'code', v_table.code, 'label', v_table.label),
    'items', v_items
  ));
end;
$$;

create or replace function public.rpc_mesa_release_table(
  p_company_id uuid,
  p_session_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_sessions%rowtype;
  v_code text;
  v_due numeric;
  v_count int;
begin
  select * into v_session
    from public.table_sessions
   where id = p_session_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '23514';
  end if;

  select count(*) into v_count from public.order_items where order_id = v_session.order_id;
  if coalesce(v_count, 0) = 0 then
    raise exception 'cart_empty' using errcode = '23502';
  end if;

  select code into v_code from public.dining_tables where id = v_session.dining_table_id;
  v_due := public.fn_mesa_refresh_due(p_company_id, v_session.order_id);
  perform public.fn_mesa_replace_parts(p_company_id, p_session_id, p_payload -> 'parts', v_due);

  update public.orders
     set customer_name = 'Mesa ' || v_code
   where id = v_session.order_id and company_id = p_company_id;

  update public.table_sessions
     set status = 'released',
         released_table_code = v_code,
         closed_at = now()
   where id = p_session_id;

  update public.dining_tables
     set status = 'free', updated_at = now()
   where id = v_session.dining_table_id and company_id = p_company_id;

  return jsonb_build_object('ok', true, 'due', v_due, 'table_code', v_code);
end;
$$;

create or replace function public.rpc_mesa_confirm_payment(
  p_company_id uuid,
  p_session_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_sessions%rowtype;
  v_cash uuid;
  v_due numeric;
  v_idem text;
  v_existing_sale uuid;
  v_existing_order uuid;
  v_sale uuid;
  v_now timestamptz := now();
  v_method text;
  v_seller text;
begin
  v_idem := 'mesa:' || p_session_id::text;
  select id into v_existing_sale
    from public.sales
   where company_id = p_company_id and idempotency_key = v_idem
   limit 1;
  if v_existing_sale is not null then
    select id into v_existing_order
      from public.orders
     where sale_id = v_existing_sale and company_id = p_company_id
     limit 1;
    return jsonb_build_object('ok', true, 'replay', true, 'sale_id', v_existing_sale, 'order_id', v_existing_order);
  end if;

  select * into v_session
    from public.table_sessions
   where id = p_session_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'released' then
    raise exception 'session_not_released' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.table_session_payments
     where session_id = p_session_id and status = 'posted'
  ) then
    raise exception 'already_posted' using errcode = '23505';
  end if;

  v_cash := nullif(trim(coalesce(p_payload ->> 'cash_register_id', '')), '')::uuid;
  if v_cash is null then
    raise exception 'cash_register_required' using errcode = '23502';
  end if;
  if not exists (
    select 1 from public.cash_registers cr
     where cr.id = v_cash and cr.company_id = p_company_id and cr.status = 'open'
  ) then
    raise exception 'cash_register_invalid' using errcode = 'P0002';
  end if;

  v_due := public.fn_mesa_refresh_due(p_company_id, v_session.order_id);
  if p_payload ? 'parts' then
    perform public.fn_mesa_replace_parts(p_company_id, p_session_id, p_payload -> 'parts', v_due);
  else
    if (
      select round(coalesce(sum(amount), 0), 2)
        from public.table_session_payments
       where session_id = p_session_id and status = 'draft'
    ) <> round(v_due, 2) then
      raise exception 'payments_mismatch' using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1 from public.table_session_payments
     where session_id = p_session_id
       and payment_method = any (array['credit_installment','boleto','promissoria','cheque'])
  ) then
    raise exception 'payment_not_allowed' using errcode = '23514';
  end if;

  select payment_method into v_method
    from public.table_session_payments
   where session_id = p_session_id and status = 'draft'
   order by amount desc, sort_order
   limit 1;

  v_seller := nullif(trim(coalesce(p_payload ->> 'seller_name', '')), '');

  insert into public.sales (
    company_id, cash_register_id, customer_id, seller_name, origin,
    subtotal, total, status, notes, order_id, idempotency_key
  ) values (
    p_company_id, v_cash, v_session.customer_id, v_seller, 'table_service',
    v_due, v_due, 'paid', 'Mesa ' || coalesce(v_session.released_table_code, ''),
    v_session.order_id, v_idem
  ) returning id into v_sale;

  insert into public.sale_items (
    sale_id, company_id, produto_embalagem_id, product_name, qty, unit_price, unit_cost
  )
  select
    v_sale, p_company_id, oi.produto_embalagem_id, oi.product_name, oi.qty, oi.unit_price,
    coalesce(public.fn_fin_snapshot_pack_cost(oi.produto_embalagem_id), 0)
    from public.order_items oi
   where oi.order_id = v_session.order_id;

  insert into public.sale_payments (sale_id, company_id, payment_method, amount, received_at)
  select v_sale, p_company_id, tsp.payment_method, tsp.amount, v_now
    from public.table_session_payments tsp
   where tsp.session_id = p_session_id and tsp.status = 'draft'
   order by tsp.sort_order;

  update public.table_session_payments
     set status = 'posted'
   where session_id = p_session_id and status = 'draft';

  update public.orders
     set sale_id = v_sale,
         status = 'finalized',
         confirmation_status = 'confirmed',
         confirmed_at = v_now,
         paid = true,
         payment_method = coalesce(v_method, 'pix'),
         printed_at = case
           when coalesce((p_payload ->> 'auto_print')::boolean, false) then v_now
           else printed_at
         end
   where id = v_session.order_id and company_id = p_company_id;

  update public.sales set order_id = v_session.order_id where id = v_sale;

  update public.table_sessions
     set status = 'closed', closed_at = now()
   where id = p_session_id;

  perform public.fn_fin_post_sale_payments(
    p_company_id, v_sale, v_session.order_id, 'table_service', v_cash
  );

  return jsonb_build_object('ok', true, 'sale_id', v_sale, 'order_id', v_session.order_id);
end;
$$;

create or replace function public.rpc_mesa_cancel_session(
  p_company_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  select * into v_session
    from public.table_sessions
   where id = p_session_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '23514';
  end if;

  delete from public.order_fees
   where order_id = v_session.order_id and company_id = p_company_id;

  delete from public.order_items
   where order_id = v_session.order_id and company_id = p_company_id;

  update public.orders
     set status = 'canceled', total = 0
   where id = v_session.order_id and company_id = p_company_id;

  update public.table_sessions
     set status = 'cancelled', closed_at = now()
   where id = p_session_id;

  update public.dining_tables
     set status = 'free', updated_at = now()
   where id = v_session.dining_table_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.rpc_mesa_transfer_session(
  p_company_id uuid,
  p_session_id uuid,
  p_target_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.table_sessions%rowtype;
  v_target public.dining_tables%rowtype;
begin
  select * into v_session
    from public.table_sessions
   where id = p_session_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '23514';
  end if;

  select * into v_target
    from public.dining_tables
   where id = p_target_table_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  if v_target.status <> 'free' then
    raise exception 'table_not_free' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.table_sessions
     where dining_table_id = p_target_table_id and status = 'open'
  ) then
    raise exception 'table_not_free' using errcode = '23514';
  end if;

  update public.dining_tables
     set status = 'free', updated_at = now()
   where id = v_session.dining_table_id;

  update public.table_sessions
     set dining_table_id = p_target_table_id
   where id = p_session_id;

  update public.dining_tables
     set status = 'occupied', updated_at = now()
   where id = p_target_table_id;

  update public.orders
     set customer_name = 'Mesa ' || v_target.code
   where id = v_session.order_id and company_id = p_company_id;

  return jsonb_build_object('ok', true, 'table_code', v_target.code);
end;
$$;

create or replace function public.rpc_mesa_list_queue(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(q.obj order by q.closed_at), '[]'::jsonb)
    into v_rows
    from (
      select ts.closed_at,
        jsonb_build_object(
          'session_id', ts.id,
          'order_id', ts.order_id,
          'table_code', ts.released_table_code,
          'customer_name', o.customer_name,
          'due', o.total_amount,
          'released_at', ts.closed_at,
          'parts', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id,
              'amount', p.amount,
              'method', p.payment_method
            ) order by p.sort_order)
              from public.table_session_payments p
             where p.session_id = ts.id and p.status = 'draft'
          ), '[]'::jsonb)
        ) as obj
      from public.table_sessions ts
      join public.orders o on o.id = ts.order_id
      where ts.company_id = p_company_id
        and ts.status = 'released'
        and o.status = 'consuming'
    ) q;
  return jsonb_build_object('ok', true, 'queue', v_rows);
end;
$$;

create or replace function public.rpc_mesa_search_catalog(
  p_company_id uuid,
  p_query text,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_lim int := least(greatest(coalesce(p_limit, 12), 1), 24);
  v_rows jsonb;
begin
  if char_length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb);
  end if;

  with hits as (
    select
      pe.id::text as id,
      'embalagem'::text as kind,
      p.id as product_id,
      case
        when nullif(trim(coalesce(pe.descricao, '')), '') is not null
          then trim(p.name) || ' ' || trim(pe.descricao)
        else trim(p.name)
      end as name,
      coalesce(sc.sigla, 'UN') as sigla,
      trim(both ' ' from concat_ws(' ', pe.volume_quantidade::text, ut.sigla)) as volume,
      public.fn_preco_efetivo_embalagem(pe.id, now()) as price,
      floor(coalesce(pv.estoque_atual, 0) / greatest(coalesce(pe.fator_conversao, 1), 0.0001)) as stock_qty,
      coalesce(p.vender_com_estoque_zero, true) as sell_zero
    from public.produto_embalagens pe
    join public.products p on p.id = pe.produto_id
    left join public.siglas_comerciais sc on sc.id = pe.id_sigla_comercial
    left join public.unit_types ut on ut.id = pe.id_unit_type
    left join public.product_volumes pv on pv.id = coalesce(
      pe.product_volume_id,
      (select pv2.id from public.product_volumes pv2
        where pv2.product_id = p.id
        order by pv2.volume_quantidade nulls last
        limit 1)
    )
    where pe.company_id = p_company_id
      and (
        p.name ilike '%' || v_q || '%'
        or coalesce(pe.descricao, '') ilike '%' || v_q || '%'
        or coalesce(p.codigo_interno, '') = v_q
        or coalesce(pe.codigo_interno, '') = v_q
        or coalesce(pe.codigo_barras_ean, '') = v_q
      )
    union all
    select
      c.id::text,
      'combo',
      null,
      c.nome,
      'COMBO',
      null,
      public.fn_preco_efetivo_combo(c.id, now()),
      public.fn_combo_disponivel(c.id)::numeric,
      false
    from public.combos c
    where c.company_id = p_company_id
      and c.is_active
      and c.nome ilike '%' || v_q || '%'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id,
    'kind', h.kind,
    'product_id', h.product_id,
    'name', h.name,
    'sigla', h.sigla,
    'volume', nullif(h.volume, ''),
    'price', h.price,
    'stock_qty', h.stock_qty,
    'sell_zero', h.sell_zero
  )), '[]'::jsonb)
    into v_rows
    from (select * from hits limit v_lim) h;

  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;

create or replace function public.rpc_mesa_top_sellers(p_company_id uuid, p_limit integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 8), 1), 16);
  v_rows jsonb;
begin
  with ranked as (
    select oi.produto_embalagem_id as id, sum(oi.qty) as sold
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.company_id = p_company_id
       and o.source = 'table_service'
       and oi.produto_embalagem_id is not null
       and oi.combo_id is null
       and o.created_at > now() - interval '90 days'
     group by oi.produto_embalagem_id
     order by sold desc
     limit v_lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pe.id,
    'kind', 'embalagem',
    'product_id', pe.produto_id,
    'name', trim(p.name),
    'sigla', coalesce(sc.sigla, 'UN'),
    'price', public.fn_preco_efetivo_embalagem(pe.id, now())
  )), '[]'::jsonb)
    into v_rows
    from ranked r
    join public.produto_embalagens pe on pe.id = r.id
    join public.products p on p.id = pe.produto_id
    left join public.siglas_comerciais sc on sc.id = pe.id_sigla_comercial;

  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;

drop function if exists public.rpc_mesa_mark_session_closed(uuid, uuid, uuid);

drop table if exists public.table_session_items;

revoke all on function public.rpc_mesa_list_floor(uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_open_session(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_add_item(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_mesa_set_item_qty(uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.rpc_mesa_remove_item(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_get_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_release_table(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_mesa_confirm_payment(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_mesa_cancel_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_transfer_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_list_queue(uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_search_catalog(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.rpc_mesa_top_sellers(uuid, integer) from public, anon, authenticated;

grant execute on function public.rpc_mesa_list_floor(uuid) to service_role;
grant execute on function public.rpc_mesa_open_session(uuid, uuid, text, uuid) to service_role;
grant execute on function public.rpc_mesa_add_item(uuid, uuid, jsonb) to service_role;
grant execute on function public.rpc_mesa_set_item_qty(uuid, uuid, uuid, numeric) to service_role;
grant execute on function public.rpc_mesa_remove_item(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_get_session(uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_release_table(uuid, uuid, jsonb) to service_role;
grant execute on function public.rpc_mesa_confirm_payment(uuid, uuid, jsonb) to service_role;
grant execute on function public.rpc_mesa_cancel_session(uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_transfer_session(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_list_queue(uuid) to service_role;
grant execute on function public.rpc_mesa_search_catalog(uuid, text, integer) to service_role;
grant execute on function public.rpc_mesa_top_sellers(uuid, integer) to service_role;

-- Apagar o último item não pode zerar total_amount e deixar a taxa de serviço de fora do check.
create or replace function public.recalc_order_totals(p_order_id uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.orders o
     set total_amount =
       coalesce((
         select sum(oi.line_total)
           from public.order_items oi
          where oi.order_id = p_order_id
       ), 0)
       + coalesce(o.delivery_fee, 0)
       + coalesce(o.service_fees_total, 0)
   where o.id = p_order_id;
$$;
