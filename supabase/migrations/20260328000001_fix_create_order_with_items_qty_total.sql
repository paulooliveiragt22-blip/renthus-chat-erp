-- ============================================================
-- Fix: create_order_with_items — qty e total_amount corretos
--
-- Problemas anteriores:
--   1. RPC inseria apenas `quantity` em order_items, não `qty`.
--      O trigger sync_order_item_qty sobrescrevia quantity = qty::integer
--      onde qty = DEFAULT da tabela (1), resultando em qty=1 em todos os pedidos.
--
--   2. RPC inseria `total_amount` diretamente sem inserir `total`.
--      O trigger calc_order_total_amount sobrescrevia total_amount = total + delivery_fee
--      onde total = NULL → total_amount = 0 + frete (total errado no DB).
--
-- Correções:
--   1. Inserir também `qty` em order_items (= quantity, satisfaz o trigger)
--   2. Aceitar `p_total` (subtotal sem frete) e inserir `total` em orders
--      O trigger calculará total_amount = total + delivery_fee automaticamente.
--   3. p_total tem DEFAULT NULL por compatibilidade com chamadas legadas:
--      fallback para p_total_amount - p_delivery_fee.
-- ============================================================

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
    p_items                         jsonb,
    p_total                         numeric DEFAULT NULL   -- subtotal sem frete; se NULL, deriva de p_total_amount - p_delivery_fee
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id uuid;
    v_total    numeric;
BEGIN
    -- Bloqueia pedido vazio antes de qualquer escrita
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'pedido não pode ser criado sem itens'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Subtotal: usa p_total se fornecido, senão deriva de p_total_amount
    v_total := COALESCE(p_total, p_total_amount - COALESCE(p_delivery_fee, 0));

    -- Cria o pedido — NÃO inserir total_amount: o trigger calc_order_total_amount
    -- calcula automaticamente como total + delivery_fee
    INSERT INTO public.orders (
        company_id, customer_id, status, confirmation_status,
        source, channel, total, delivery_fee, delivery_address,
        delivery_endereco_cliente_id, payment_method, change_for, paid
    ) VALUES (
        p_company_id, p_customer_id, p_status, p_confirmation_status,
        p_source, p_channel, v_total, p_delivery_fee, p_delivery_address,
        p_delivery_endereco_cliente_id, p_payment_method, p_change_for, p_paid
    )
    RETURNING id INTO v_order_id;

    -- Insere os itens — inclui qty (= quantity) para satisfazer o trigger sync_order_item_qty
    -- sem qty explícito, o trigger sobrescreveria quantity com o default da coluna (1)
    INSERT INTO public.order_items (
        order_id, company_id, product_name, produto_embalagem_id,
        quantity, qty, unit_price
    )
    SELECT
        v_order_id,
        p_company_id,
        (item->>'product_name')::text,
        (item->>'produto_embalagem_id')::uuid,
        (item->>'quantity')::integer,
        (item->>'quantity')::numeric,   -- qty = quantity para manter sync
        (item->>'unit_price')::numeric
    FROM jsonb_array_elements(p_items) AS item;

    RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_items TO service_role;
