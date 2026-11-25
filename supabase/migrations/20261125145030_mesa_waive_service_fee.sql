-- A comanda pode retirar a taxa de serviço desta mesa. A definição da empresa continua ativa.

alter table public.table_sessions
  add column if not exists waive_service_fee boolean not null default false;

create or replace function public.fn_mesa_service_fee_waived(p_company_id uuid, p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select ts.waive_service_fee
      from public.table_sessions ts
     where ts.company_id = p_company_id
       and ts.order_id = p_order_id
     order by ts.opened_at desc
     limit 1
  ), false);
$$;

create or replace function public.fn_mesa_compute_due(p_company_id uuid, p_order_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items numeric := 0;
  v_fee numeric := 0;
  r record;
begin
  select coalesce(sum(coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0)), 0)
    into v_items
    from public.order_items oi
   where oi.order_id = p_order_id and oi.company_id = p_company_id;

  if public.fn_mesa_service_fee_waived(p_company_id, p_order_id) then
    return round(v_items, 2);
  end if;

  for r in
    select d.calc_mode, d.value
      from public.service_fee_definitions d
     where d.company_id = p_company_id
       and d.is_active
       and d.system_key = 'service'
  loop
    v_fee := v_fee + public.fn_mesa_fee_amount(v_items, r.calc_mode, r.value);
  end loop;

  return round(v_items + v_fee, 2);
end;
$$;

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

  if public.fn_mesa_service_fee_waived(p_company_id, p_order_id) then
    return round(v_items, 2);
  end if;

  for r in
    select d.id, d.name, d.calc_mode, d.value
      from public.service_fee_definitions d
     where d.company_id = p_company_id
       and d.is_active
       and d.system_key = 'service'
  loop
    v_amt := public.fn_mesa_fee_amount(v_items, r.calc_mode, r.value);
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
  v_subtotal numeric := 0;
  v_fee_name text;
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

  if v_session.order_id is not null then
    select coalesce(sum(coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0)), 0)
      into v_subtotal
      from public.order_items oi
     where oi.order_id = v_session.order_id and oi.company_id = p_company_id;
  end if;

  select d.name into v_fee_name
    from public.service_fee_definitions d
   where d.company_id = p_company_id
     and d.is_active
     and d.system_key = 'service'
   order by d.created_at
   limit 1;

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
    'items_subtotal', round(v_subtotal, 2),
    'service_fee', case
      when coalesce(v_session.waive_service_fee, false) then 0
      else round(v_due - round(v_subtotal, 2), 2)
    end,
    'service_fee_waived', coalesce(v_session.waive_service_fee, false),
    'service_fee_offered', v_fee_name is not null,
    'service_fee_name', coalesce(v_fee_name, 'Taxa de serviço'),
    'notes', v_session.notes,
    'customer_id', v_session.customer_id,
    'previous_table_codes', coalesce(to_jsonb(v_session.previous_table_codes), '[]'::jsonb),
    'table', jsonb_build_object('id', v_table.id, 'code', v_table.code, 'label', v_table.label),
    'items', v_items
  ));
end;
$$;

create or replace function public.rpc_mesa_set_service_fee(
  p_company_id uuid,
  p_session_id uuid,
  p_waived boolean
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
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  update public.table_sessions
     set waive_service_fee = coalesce(p_waived, false)
   where id = v_session.id and company_id = p_company_id;

  perform public.fn_mesa_refresh_due(p_company_id, v_session.order_id);
  return public.rpc_mesa_get_session(p_company_id, p_session_id);
end;
$$;

revoke all on function public.fn_mesa_service_fee_waived(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_mesa_compute_due(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_mesa_refresh_due(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_get_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_mesa_set_service_fee(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_mesa_service_fee_waived(uuid, uuid) to service_role;
grant execute on function public.fn_mesa_compute_due(uuid, uuid) to service_role;
grant execute on function public.fn_mesa_refresh_due(uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_get_session(uuid, uuid) to service_role;
grant execute on function public.rpc_mesa_set_service_fee(uuid, uuid, boolean) to service_role;
