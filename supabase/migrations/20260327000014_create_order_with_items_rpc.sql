-- Remove trigger anterior (migration 13 criou trigger de DELETE — comportamento errado)
DROP TRIGGER IF EXISTS trg_order_must_have_items ON public.order_items;
DROP FUNCTION IF EXISTS public.enforce_order_has_items();

-- RPC: cria pedido + itens em uma única transação.
-- Garante atomicidade: ou cria tudo ou nada. Bloqueia pedido vazio.

CREATE OR REPLACE FUNCTION public.create_order_with_items(
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
    p_items                         jsonb   -- [{ product_name, produto_embalagem_id, quantity, unit_price }]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id uuid;
BEGIN
    -- Bloqueia pedido vazio antes de qualquer escrita
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'pedido não pode ser criado sem itens'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Cria o pedido
    INSERT INTO public.orders (
        company_id, customer_id, status, confirmation_status,
        source, channel, total_amount, delivery_fee, delivery_address,
        delivery_endereco_cliente_id, payment_method, change_for, paid
    ) VALUES (
        p_company_id, p_customer_id, p_status, p_confirmation_status,
        p_source, p_channel, p_total_amount, p_delivery_fee, p_delivery_address,
        p_delivery_endereco_cliente_id, p_payment_method, p_change_for, p_paid
    )
    RETURNING id INTO v_order_id;

    -- Insere os itens (line_total é coluna gerada — omitida)
    INSERT INTO public.order_items (order_id, company_id, product_name, produto_embalagem_id, quantity, unit_price)
    SELECT
        v_order_id,
        p_company_id,
        (item->>'product_name')::text,
        (item->>'produto_embalagem_id')::uuid,
        (item->>'quantity')::integer,
        (item->>'unit_price')::numeric
    FROM jsonb_array_elements(p_items) AS item;

    RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_items TO service_role;
