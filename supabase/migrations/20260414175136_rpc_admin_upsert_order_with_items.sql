-- RPC transacional: criar pedido + itens OU atualizar cabeçalho + substituir itens (admin).
-- Garante atomicidade e total (subtotal) coerente com as linhas.
-- Aplicado no remoto via MCP Supabase (apply_migration); manter versão alinhada ao histórico.

CREATE OR REPLACE FUNCTION public.rpc_admin_upsert_order_with_items(
    p_company_id            uuid,
    p_order_id              uuid,
    p_customer_id           uuid,
    p_channel               text,
    p_status                text,
    p_confirmation_status   text,
    p_payment_method        text,
    p_paid                  boolean,
    p_change_for            numeric,
    p_delivery_fee          numeric,
    p_details               text,
    p_driver_id             uuid,
    p_source                text,
    p_items                 jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id      uuid;
    v_line_subtotal numeric;
    v_src           text;
    v_ch            text;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'pedido não pode ser salvo sem itens'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(
        SUM(
            COALESCE((item->>'quantity')::numeric, 0)
            * COALESCE((item->>'unit_price')::numeric, 0)
        ),
        0
    )
    INTO v_line_subtotal
    FROM jsonb_array_elements(p_items) AS item;

    v_src := COALESCE(NULLIF(trim(p_source), ''), 'ui');
    v_ch  := COALESCE(NULLIF(trim(p_channel), ''), 'admin');

    IF p_order_id IS NULL THEN
        INSERT INTO public.orders (
            company_id,
            customer_id,
            status,
            confirmation_status,
            source,
            channel,
            total,
            delivery_fee,
            payment_method,
            change_for,
            paid,
            details,
            driver_id
        ) VALUES (
            p_company_id,
            p_customer_id,
            COALESCE(NULLIF(trim(p_status), ''), 'new'),
            COALESCE(NULLIF(trim(p_confirmation_status), ''), 'confirmed'),
            v_src,
            v_ch,
            v_line_subtotal,
            COALESCE(p_delivery_fee, 0),
            COALESCE(NULLIF(trim(p_payment_method), ''), 'pix'),
            p_change_for,
            COALESCE(p_paid, false),
            NULLIF(trim(p_details), ''),
            p_driver_id
        )
        RETURNING id INTO v_order_id;
    ELSE
        v_order_id := p_order_id;
        IF NOT EXISTS (
            SELECT 1
            FROM public.orders o
            WHERE o.id = v_order_id
              AND o.company_id = p_company_id
        ) THEN
            RAISE EXCEPTION 'order not found for company';
        END IF;

        UPDATE public.orders o
        SET
            customer_id           = p_customer_id,
            status                = COALESCE(NULLIF(trim(p_status), ''), o.status),
            confirmation_status   = COALESCE(NULLIF(trim(p_confirmation_status), ''), o.confirmation_status),
            channel                 = COALESCE(NULLIF(trim(p_channel), ''), o.channel),
            source                  = COALESCE(NULLIF(trim(p_source), ''), o.source),
            total                   = v_line_subtotal,
            delivery_fee            = COALESCE(p_delivery_fee, 0),
            payment_method          = COALESCE(NULLIF(trim(p_payment_method), ''), o.payment_method),
            change_for              = p_change_for,
            paid                    = COALESCE(p_paid, o.paid),
            details                 = CASE
                WHEN p_details IS NULL THEN o.details
                ELSE NULLIF(trim(p_details), '')
            END,
            driver_id               = p_driver_id
        WHERE o.id = v_order_id
          AND o.company_id = p_company_id;

        DELETE FROM public.order_items oi
        WHERE oi.order_id = v_order_id
          AND oi.company_id = p_company_id;
    END IF;

    INSERT INTO public.order_items (
        order_id,
        company_id,
        product_name,
        produto_embalagem_id,
        quantity,
        qty,
        unit_price,
        unit_type
    )
    SELECT
        v_order_id,
        p_company_id,
        COALESCE(item->>'product_name', ''),
        CASE
            WHEN nullif(trim(COALESCE(item->>'produto_embalagem_id', '')), '') IS NULL THEN NULL
            ELSE (nullif(trim(item->>'produto_embalagem_id'), ''))::uuid
        END,
        GREATEST(1, COALESCE((item->>'quantity')::integer, 1)),
        GREATEST(1::numeric, COALESCE((item->>'quantity')::numeric, 1)),
        COALESCE((item->>'unit_price')::numeric, 0),
        COALESCE(nullif(trim(item->>'unit_type'), ''), 'unit')
    FROM jsonb_array_elements(p_items) AS item;

    RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb
) IS 'Admin: cria pedido+itens (p_order_id NULL) ou substitui itens e atualiza cabeçalho em uma transação.';
