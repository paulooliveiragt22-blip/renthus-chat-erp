-- Troca de mesa guarda o código da mesa de origem no histórico da comanda.

alter table public.table_sessions
  add column if not exists previous_table_codes text[] not null default '{}';

create or replace function public.fn_mesa_customer_label(p_code text, p_previous text[])
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'Mesa ' || coalesce(p_code, '') ||
    case
      when coalesce(cardinality(p_previous), 0) = 0 then ''
      else ' · antes ' || (
        select string_agg('Mesa ' || code, ', ' order by ord)
          from unnest(p_previous) with ordinality as trail(code, ord)
      )
    end;
$$;

revoke all on function public.fn_mesa_customer_label(text, text[]) from public, anon, authenticated;
grant execute on function public.fn_mesa_customer_label(text, text[]) to service_role;

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
  v_from text;
  v_prev text[];
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

  select code into v_from
    from public.dining_tables
   where id = v_session.dining_table_id and company_id = p_company_id;

  v_prev := coalesce(v_session.previous_table_codes, '{}'::text[]);
  if nullif(trim(coalesce(v_from, '')), '') is not null then
    v_prev := v_prev || array[v_from];
  end if;

  update public.dining_tables
     set status = 'free', updated_at = now()
   where id = v_session.dining_table_id;

  update public.table_sessions
     set dining_table_id = p_target_table_id,
         previous_table_codes = v_prev
   where id = p_session_id;

  update public.dining_tables
     set status = 'occupied', updated_at = now()
   where id = p_target_table_id;

  update public.orders
     set customer_name = public.fn_mesa_customer_label(v_target.code, v_prev)
   where id = v_session.order_id and company_id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'table_code', v_target.code,
    'previous_table_codes', to_jsonb(v_prev)
  );
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
    'previous_table_codes', coalesce(to_jsonb(v_session.previous_table_codes), '[]'::jsonb),
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
     set customer_name = public.fn_mesa_customer_label(v_code, v_session.previous_table_codes)
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
    v_due, v_due, 'paid', public.fn_mesa_customer_label(v_session.released_table_code, v_session.previous_table_codes),
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
          'previous_table_codes', coalesce(to_jsonb(ts.previous_table_codes), '[]'::jsonb),
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

revoke all on function public.rpc_mesa_transfer_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_get_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_release_table(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_mesa_confirm_payment(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_mesa_list_queue(uuid) from public, anon, authenticated;

grant execute on function public.rpc_mesa_transfer_session(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_get_session(uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_release_table(uuid, uuid, jsonb) to service_role;
grant execute on function public.rpc_mesa_confirm_payment(uuid, uuid, jsonb) to service_role;
grant execute on function public.rpc_mesa_list_queue(uuid) to service_role;
