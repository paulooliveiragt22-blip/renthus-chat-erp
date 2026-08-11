-- Idempotência real na criação de pedido: retry/double-click com a mesma chave
-- devolve o pedido já criado em vez de duplicar (checklist item 3,
-- docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md).

alter table public.orders
    add column if not exists idempotency_key text;

-- Única por empresa; NULL não colide (pedidos legados / origem sem chave).
create unique index if not exists orders_idempotency_key_unique
    on public.orders (company_id, idempotency_key)
    where idempotency_key is not null;

-- Dropar a versão anterior (15 params) antes de criar a nova (16 params) —
-- evita overload ambíguo no GRANT, mesmo padrão de 20260328000001.
drop function if exists public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric
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
    p_idempotency_key               text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order_id uuid;
    v_total    numeric;
begin
    -- Idempotência: já existe pedido com essa chave nesta empresa? Devolve o
    -- mesmo id, não insere de novo. Só entra nesse caminho quando a chave é
    -- informada — chamador legado sem chave mantém o comportamento antigo.
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

    v_total := coalesce(p_total, p_total_amount - coalesce(p_delivery_fee, 0));

    insert into public.orders (
        company_id, customer_id, status, confirmation_status,
        source, channel, total, delivery_fee, delivery_address,
        delivery_endereco_cliente_id, payment_method, change_for, paid,
        idempotency_key
    ) values (
        p_company_id, p_customer_id, p_status, p_confirmation_status,
        p_source, p_channel, v_total, p_delivery_fee, p_delivery_address,
        p_delivery_endereco_cliente_id, p_payment_method, p_change_for, p_paid,
        p_idempotency_key
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
    -- Corrida rara: 2 chamadas concorrentes com a mesma chave passam pelo
    -- select acima antes de qualquer insert concluir. O unique index resolve
    -- a corrida — quem perder cai aqui e devolve o pedido do vencedor.
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
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text
) from public;

grant execute on function public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text
) to service_role;
