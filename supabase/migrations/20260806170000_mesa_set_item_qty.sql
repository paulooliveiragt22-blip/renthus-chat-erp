-- Mesa: alterar qty de item (0 = remove)
CREATE OR REPLACE FUNCTION public.rpc_mesa_set_item_qty(
    p_company_id uuid,
    p_session_id uuid,
    p_item_id uuid,
    p_qty numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session public.table_sessions%ROWTYPE;
    v_item public.table_session_items%ROWTYPE;
BEGIN
    SELECT * INTO v_session
    FROM public.table_sessions
    WHERE id = p_session_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_session.status <> 'open' THEN
        RAISE EXCEPTION 'session_not_open' USING ERRCODE = '23514';
    END IF;

    IF p_qty IS NULL OR p_qty <= 0 THEN
        DELETE FROM public.table_session_items
        WHERE id = p_item_id AND session_id = p_session_id AND company_id = p_company_id;
        RETURN jsonb_build_object('ok', true, 'removed', true);
    END IF;

    UPDATE public.table_session_items
    SET qty = p_qty
    WHERE id = p_item_id AND session_id = p_session_id AND company_id = p_company_id
    RETURNING * INTO v_item;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'item', jsonb_build_object(
            'id', v_item.id,
            'produto_embalagem_id', v_item.produto_embalagem_id,
            'product_id', v_item.product_id,
            'product_name', v_item.product_name,
            'qty', v_item.qty,
            'unit_price', v_item.unit_price,
            'sigla_comercial', v_item.sigla_comercial
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mesa_set_item_qty(uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_set_item_qty(uuid, uuid, uuid, numeric) TO service_role;
