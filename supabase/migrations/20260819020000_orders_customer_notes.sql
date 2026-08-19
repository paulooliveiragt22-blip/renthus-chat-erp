-- Observação do cliente no pedido (`orders.notes`).
-- `orders.details` continua interno (cancelamento / dashboard).
-- RPC: p_order_notes (18º param, default null).

comment on column public.orders.notes is
  'Observação do cliente no resumo do pedido (cardápio/chat). Não usar details (interno).';

drop function if exists public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text
);
drop function if exists public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text, text
);

create or replace function public.create_order_with_items(
    p_company_id                    uuid,
    p_customer_id                   uuid,
    p_status                        text,
    p_confirmation_status           text,
    p_source                        text,
    p_channel                       text,
    p_total_amount                  numeric,
    p_delivery_fee                  numeric,
    p_delivery_address              text,
    p_delivery_endereco_cliente_id  uuid,
    p_payment_method                text,
    p_change_for                    numeric,
    p_paid                          boolean,
    p_items                         jsonb,
    p_total                         numeric default null,
    p_idempotency_key               text default null,
    p_fulfillment_type              text default 'delivery',
    p_order_notes                   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order_id uuid;
    v_total    numeric;
    v_fulfill  text;
    v_fee      numeric;
    v_addr     text;
    v_addr_id  uuid;
    v_del      boolean;
    v_pick     boolean;
    v_notes    text;
begin
    v_fulfill := lower(coalesce(nullif(trim(p_fulfillment_type), ''), 'delivery'));
    if v_fulfill not in ('delivery', 'pickup') then
        raise exception 'fulfillment_type inválido'
            using errcode = 'check_violation';
    end if;

    v_notes := nullif(left(btrim(coalesce(p_order_notes, '')), 500), '');

    select
        coalesce(deliveries_enabled, true),
        coalesce(pickup_enabled, true)
      into v_del, v_pick
      from public.company_delivery_policy
     where company_id = p_company_id;

    if not found then
        v_del := true;
        v_pick := true;
    end if;

    if v_fulfill = 'delivery' and v_del is not true then
        raise exception 'entregas desativadas nesta loja'
            using errcode = 'check_violation';
    end if;
    if v_fulfill = 'pickup' and v_pick is not true then
        raise exception 'retirada desativada nesta loja'
            using errcode = 'check_violation';
    end if;

    if p_idempotency_key is not null then
        select id into v_order_id
        from public.orders
        where company_id = p_company_id
          and idempotency_key = p_idempotency_key
        limit 1;

        if v_order_id is not null then
            return v_order_id;
        end if;
    end if;

    if p_items is null or jsonb_array_length(p_items) = 0 then
        raise exception 'pedido não pode ser criado sem itens'
            using errcode = 'check_violation';
    end if;

    if v_fulfill = 'pickup' then
        v_fee := 0;
        v_addr := coalesce(nullif(trim(p_delivery_address), ''), 'Retirada no local');
        v_addr_id := null;
        v_total := coalesce(p_total, p_total_amount);
    else
        v_fee := coalesce(p_delivery_fee, 0);
        v_addr := p_delivery_address;
        v_addr_id := p_delivery_endereco_cliente_id;
        v_total := coalesce(p_total, p_total_amount - v_fee);
    end if;

    insert into public.orders (
        company_id, customer_id, status, confirmation_status,
        source, channel, total, delivery_fee, delivery_address,
        delivery_endereco_cliente_id, payment_method, change_for, paid,
        idempotency_key, fulfillment_type, notes
    ) values (
        p_company_id, p_customer_id, p_status, p_confirmation_status,
        p_source, p_channel, v_total, v_fee, v_addr,
        v_addr_id, p_payment_method, p_change_for, p_paid,
        p_idempotency_key, v_fulfill, v_notes
    )
    returning id into v_order_id;

    insert into public.order_items (
        order_id, company_id, product_name, produto_embalagem_id,
        quantity, qty, unit_price
    )
    select
        v_order_id,
        p_company_id,
        (item->>'product_name')::text,
        (item->>'produto_embalagem_id')::uuid,
        (item->>'quantity')::integer,
        (item->>'quantity')::numeric,
        (item->>'unit_price')::numeric
    from jsonb_array_elements(p_items) as item;

    return v_order_id;
exception
    when unique_violation then
        if p_idempotency_key is not null then
            select id into v_order_id
            from public.orders
            where company_id = p_company_id
              and idempotency_key = p_idempotency_key
            limit 1;
            if v_order_id is not null then
                return v_order_id;
            end if;
        end if;
        raise;
end;
$$;

revoke all on function public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text, text
) from public;

revoke all on function public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text, text
) from anon, authenticated;

grant execute on function public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text, text
) to service_role;
