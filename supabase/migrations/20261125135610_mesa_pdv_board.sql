-- O PDV lista mesas em aberto e comandas já fechadas pelo garçom.

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
          'due', coalesce(o.total_amount, o.total, 0),
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

revoke all on function public.rpc_mesa_list_pdv_board(uuid) from public, anon, authenticated;
grant execute on function public.rpc_mesa_list_pdv_board(uuid) to service_role;
