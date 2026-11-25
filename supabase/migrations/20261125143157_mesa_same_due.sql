-- Salão e PDV mostram a mesma conta: itens + taxa de serviço ativa.

create or replace function public.fn_mesa_fee_amount(p_items numeric, p_mode text, p_value numeric)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when round(
      case
        when p_mode = 'percent' then coalesce(p_items, 0) * coalesce(p_value, 0) / 100.0
        else coalesce(p_value, 0)
      end
    , 2) > 0
    then round(
      case
        when p_mode = 'percent' then coalesce(p_items, 0) * coalesce(p_value, 0) / 100.0
        else coalesce(p_value, 0)
      end
    , 2)
    else 0
  end;
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
        case
          when s.order_id is null then 0
          else public.fn_mesa_compute_due(dt.company_id, s.order_id)
        end as session_total,
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

create or replace function public.rpc_mesa_list_pdv_board(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open jsonb;
  v_queue jsonb;
begin
  select coalesce(jsonb_agg(q.obj order by q.opened_at), '[]'::jsonb)
    into v_open
    from (
      select ts.opened_at,
        jsonb_build_object(
          'session_id', ts.id,
          'table_code', dt.code,
          'table_label', dt.label,
          'opened_at', ts.opened_at,
          'due', public.fn_mesa_compute_due(ts.company_id, ts.order_id),
          'items_count', (
            select count(*)::int from public.order_items oi where oi.order_id = ts.order_id
          ),
          'previous_table_codes', coalesce(to_jsonb(ts.previous_table_codes), '[]'::jsonb)
        ) as obj
      from public.table_sessions ts
      join public.dining_tables dt on dt.id = ts.dining_table_id
      join public.orders o on o.id = ts.order_id
      where ts.company_id = p_company_id
        and ts.status = 'open'
        and o.status = 'consuming'
    ) q;

  select coalesce(jsonb_agg(q.obj order by q.closed_at), '[]'::jsonb)
    into v_queue
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

  return jsonb_build_object('ok', true, 'open', v_open, 'queue', v_queue);
end;
$$;

revoke all on function public.fn_mesa_fee_amount(numeric, text, numeric) from public, anon, authenticated;
revoke all on function public.fn_mesa_compute_due(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_mesa_refresh_due(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mesa_fee_amount(numeric, text, numeric) to service_role;
grant execute on function public.fn_mesa_compute_due(uuid, uuid) to service_role;
grant execute on function public.fn_mesa_refresh_due(uuid, uuid) to service_role;
