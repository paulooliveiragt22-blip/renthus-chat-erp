-- M5: status `preparing` + RPC de transição canônica.
-- Notify ao cliente fica no app (outbound_jobs), best-effort após a RPC.

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status = any (array[
    'new'::text,
    'preparing'::text,
    'delivered'::text,
    'finalized'::text,
    'canceled'::text
  ]));

comment on constraint orders_status_check on public.orders is
  'Ciclo: new → preparing → delivered|finalized|canceled. Retirada: preparing → finalized (sem delivered).';

create or replace function public.rpc_set_order_status(
    p_company_id     uuid,
    p_order_id       uuid,
    p_status         text,
    p_details        text default null,
    p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_cur        text;
    v_next       text;
    v_fulfill    text;
    v_customer   uuid;
    v_code       text;
begin
    v_next := lower(trim(coalesce(p_status, '')));
    if v_next not in ('new', 'preparing', 'delivered', 'finalized', 'canceled') then
        raise exception 'status inválido: %', v_next
            using errcode = 'check_violation';
    end if;

    select
        o.status,
        coalesce(o.fulfillment_type, 'delivery'),
        o.customer_id
      into v_cur, v_fulfill, v_customer
      from public.orders o
     where o.id = p_order_id
       and o.company_id = p_company_id
     for update;

    if not found then
        raise exception 'pedido não encontrado'
            using errcode = 'no_data_found';
    end if;

    if v_cur = v_next then
        return jsonb_build_object(
            'ok', true,
            'order_id', p_order_id,
            'status', v_cur,
            'changed', false,
            'fulfillment_type', v_fulfill,
            'customer_id', v_customer
        );
    end if;

    -- Allowlist de transições
    if not (
        (v_cur = 'new' and v_next in ('preparing', 'delivered', 'finalized', 'canceled'))
        or (v_cur = 'preparing' and v_next in ('delivered', 'finalized', 'canceled'))
        or (v_cur = 'delivered' and v_next in ('finalized'))
    ) then
        raise exception 'transição de status não permitida: % → %', v_cur, v_next
            using errcode = 'check_violation';
    end if;

    -- Retirada: não usa "em entrega"
    if v_fulfill = 'pickup' and v_next = 'delivered' then
        raise exception 'pedido de retirada não pode ir para em entrega'
            using errcode = 'check_violation';
    end if;

    update public.orders
       set status = v_next,
           details = case
               when p_details is null then details
               when nullif(trim(p_details), '') is null then details
               else trim(p_details)
           end,
           payment_method = coalesce(nullif(trim(p_payment_method), ''), payment_method)
     where id = p_order_id
       and company_id = p_company_id;

    v_code := '#' || upper(right(replace(p_order_id::text, '-', ''), 6));

    return jsonb_build_object(
        'ok', true,
        'order_id', p_order_id,
        'status', v_next,
        'previous_status', v_cur,
        'changed', true,
        'fulfillment_type', v_fulfill,
        'customer_id', v_customer,
        'order_code', v_code
    );
end;
$$;

revoke all on function public.rpc_set_order_status(uuid, uuid, text, text, text) from public;
revoke all on function public.rpc_set_order_status(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function public.rpc_set_order_status(uuid, uuid, text, text, text) to service_role;

comment on function public.rpc_set_order_status(uuid, uuid, text, text, text) is
  'M5: altera orders.status com allowlist. Cancelamento preferencial via rpc_admin_cancel_order.';
