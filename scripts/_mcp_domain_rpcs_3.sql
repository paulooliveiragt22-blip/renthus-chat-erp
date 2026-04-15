
-- ─── PDV: finalização (espelha app/api/admin/pdv/finalize/route.ts) ───────────

CREATE OR REPLACE FUNCTION public.rpc_finalize_pdv_order(
    p_company_id uuid,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cash_id        uuid;
    v_cart           jsonb := p_payload -> 'cart';
    v_payments       jsonb := p_payload -> 'payments';
    v_cart_total     numeric := 0;
    v_pay_total      numeric := 0;
    v_line           jsonb;
    v_pay            jsonb;
    v_has_credit     boolean := false;
    v_customer_id    uuid;
    v_seller_name    text;
    v_active_oid     uuid;
    v_active_src     text;
    v_primary_method text := 'pix';
    v_primary_val    numeric := 0;
    v_is_paid        boolean;
    v_sale_origin    text;
    v_fin_origin     text;
    v_sale_id        uuid;
    v_oid            uuid;
    v_display_name   text;
    v_m              text;
    v_now            timestamptz := now();
    v_auto_print     boolean := COALESCE((p_payload ->> 'auto_print')::boolean, false);
BEGIN
    v_cash_id := NULLIF(trim(COALESCE(p_payload ->> 'cash_register_id', '')), '')::uuid;
    IF v_cash_id IS NULL THEN
        RAISE EXCEPTION 'cash_register_required' USING ERRCODE = '23502';
    END IF;

    IF v_cart IS NULL OR jsonb_array_length(v_cart) = 0 THEN
        RAISE EXCEPTION 'cart_empty' USING ERRCODE = '23502';
    END IF;

    IF v_payments IS NULL OR jsonb_array_length(v_payments) = 0 THEN
        RAISE EXCEPTION 'payments_required' USING ERRCODE = '23502';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(v_cart)
    LOOP
        v_cart_total := v_cart_total
            + COALESCE((v_line ->> 'unit_price')::numeric, 0) * COALESCE((v_line ->> 'qty')::numeric, 0);
    END LOOP;

    FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments)
    LOOP
        v_pay_total := v_pay_total + COALESCE((v_pay ->> 'value')::numeric, 0);
        v_m := lower(trim(COALESCE(v_pay ->> 'method', '')));
        IF v_m = ANY (ARRAY['credit', 'boleto', 'cheque', 'promissoria']) THEN
            v_has_credit := true;
        END IF;
    END LOOP;

    IF v_pay_total < v_cart_total THEN
        RAISE EXCEPTION 'payments_insufficient' USING ERRCODE = '23514';
    END IF;

    v_customer_id := NULLIF(trim(COALESCE(p_payload ->> 'customer_id', '')), '')::uuid;
    IF v_has_credit AND v_customer_id IS NULL THEN
        RAISE EXCEPTION 'customer_required_for_prazo' USING ERRCODE = '23502';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.cash_registers cr
        WHERE cr.id = v_cash_id AND cr.company_id = p_company_id AND cr.status = 'open'
    ) THEN
        RAISE EXCEPTION 'cash_register_invalid' USING ERRCODE = 'P0002';
    END IF;

    v_seller_name := nullif(trim(COALESCE(p_payload ->> 'seller_name', '')), '');
    v_active_oid := NULLIF(trim(COALESCE(p_payload ->> 'active_order_id', '')), '')::uuid;
    v_active_src := nullif(trim(COALESCE(p_payload ->> 'active_order_source', '')), '');

    FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments)
    LOOP
        IF COALESCE((v_pay ->> 'value')::numeric, 0) >= v_primary_val THEN
            v_primary_val := COALESCE((v_pay ->> 'value')::numeric, 0);
            v_primary_method := trim(COALESCE(v_pay ->> 'method', 'pix'));
        END IF;
    END LOOP;

    v_is_paid := NOT v_has_credit;

    IF v_active_src IS NULL OR v_active_src = 'pdv_direct' THEN
        v_sale_origin := 'pdv';
    ELSIF v_active_src = 'chatbot' OR v_active_src ~ '^flow_' THEN
        v_sale_origin := 'chatbot';
    ELSIF v_active_src = 'ui' THEN
        v_sale_origin := 'ui_order';
    ELSE
        v_sale_origin := 'pdv';
    END IF;

    IF v_sale_origin = 'chatbot' THEN
        v_fin_origin := 'chatbot';
    ELSIF v_sale_origin = 'ui_order' THEN
        v_fin_origin := 'ui_order';
    ELSE
        v_fin_origin := 'balcao';
    END IF;

    INSERT INTO public.sales (
        company_id, cash_register_id, customer_id, seller_name, origin,
        subtotal, total, status, notes, order_id
    )
    VALUES (
        p_company_id,
        v_cash_id,
        v_customer_id,
        v_seller_name,
        v_sale_origin,
        v_cart_total,
        v_cart_total,
        CASE WHEN v_is_paid THEN 'paid'::text ELSE 'partial'::text END,
        CASE WHEN v_seller_name IS NOT NULL THEN 'Balcão — ' || v_seller_name ELSE 'Balcão' END,
        v_active_oid
    )
    RETURNING id INTO v_sale_id;

    INSERT INTO public.sale_items (
        sale_id, company_id, produto_embalagem_id, product_name, qty, unit_price, unit_cost
    )
    SELECT
        v_sale_id,
        p_company_id,
        NULLIF(trim(v_line ->> 'variant_id'), '')::uuid,
        trim(COALESCE(v_line ->> 'product_name', ''))
            || CASE WHEN nullif(trim(COALESCE(v_line ->> 'details', '')), '') IS NOT NULL
                THEN ' ' || trim(v_line ->> 'details') ELSE '' END,
        COALESCE((v_line ->> 'qty')::numeric, 0),
        COALESCE((v_line ->> 'unit_price')::numeric, 0),
        0
    FROM jsonb_array_elements(v_cart) AS t(v_line);

    INSERT INTO public.sale_payments (
        sale_id, company_id, payment_method, amount, due_date, received_at
    )
    SELECT
        v_sale_id,
        p_company_id,
        CASE WHEN lower(trim(COALESCE(v_pay ->> 'method', ''))) = 'credit'
            THEN 'credit_installment' ELSE lower(trim(COALESCE(v_pay ->> 'method', 'pix'))) END,
        COALESCE((v_pay ->> 'value')::numeric, 0),
        CASE WHEN nullif(trim(COALESCE(v_pay ->> 'due_date', '')), '') IS NOT NULL
            THEN (trim(v_pay ->> 'due_date'))::date ELSE NULL END,
        CASE WHEN lower(trim(COALESCE(v_pay ->> 'method', ''))) = ANY (
                ARRAY['credit', 'boleto', 'cheque', 'promissoria']::text[]
            )
            THEN NULL ELSE v_now END
    FROM jsonb_array_elements(v_payments) AS p(v_pay);

    IF v_active_oid IS NOT NULL THEN
        UPDATE public.orders o
        SET
            sale_id               = v_sale_id,
            status                = 'finalized',
            confirmation_status   = 'confirmed',
            confirmed_at          = v_now,
            printed_at            = CASE WHEN v_auto_print THEN v_now ELSE o.printed_at END
        WHERE o.id = v_active_oid AND o.company_id = p_company_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'active_order_not_found' USING ERRCODE = 'P0002';
        END IF;

        v_oid := v_active_oid;
    ELSE
        v_display_name := nullif(trim(COALESCE(p_payload ->> 'customer_name', '')), '');
        IF v_display_name IS NULL THEN
            v_display_name := CASE
                WHEN v_seller_name IS NOT NULL THEN '[Balcão] ' || v_seller_name
                ELSE 'Balcão'
            END;
        END IF;

        INSERT INTO public.orders (
            company_id, sale_id, source, customer_id, customer_name,
            total, total_amount, delivery_fee, payment_method, status, channel, paid, confirmed_at
        )
        VALUES (
            p_company_id,
            v_sale_id,
            'pdv_direct',
            v_customer_id,
            v_display_name,
            v_cart_total,
            v_cart_total,
            0,
            COALESCE(nullif(trim(v_primary_method), ''), 'pix'),
            'finalized',
            'balcao',
            v_is_paid,
            v_now
        )
        RETURNING id INTO v_oid;

        INSERT INTO public.order_items (
            company_id, order_id, product_id, produto_embalagem_id, product_name,
            quantity, qty, unit_type, unit_price
        )
        SELECT
            p_company_id,
            v_oid,
            NULLIF(trim(v_line ->> 'produto_id'), '')::uuid,
            NULLIF(trim(v_line ->> 'variant_id'), '')::uuid,
            trim(COALESCE(v_line ->> 'product_name', ''))
                || CASE WHEN nullif(trim(COALESCE(v_line ->> 'details', '')), '') IS NOT NULL
                    THEN ' ' || trim(v_line ->> 'details') ELSE '' END,
            COALESCE((v_line ->> 'qty')::integer, 1),
            COALESCE((v_line ->> 'qty')::numeric, 0),
            CASE WHEN upper(trim(COALESCE(v_line ->> 'sigla_comercial', ''))) = 'CX'
                THEN 'case'::text ELSE 'unit'::text END,
            COALESCE((v_line ->> 'unit_price')::numeric, 0)
        FROM jsonb_array_elements(v_cart) AS t2(v_line);
    END IF;

    INSERT INTO public.financial_entries (
        company_id, order_id, sale_id, type, amount, delivery_fee,
        payment_method, origin, description, occurred_at, status, due_date, received_at
    )
    SELECT
        p_company_id,
        v_oid,
        v_sale_id,
        'income',
        COALESCE((v_pay ->> 'value')::numeric, 0),
        0,
        CASE WHEN lower(trim(COALESCE(v_pay ->> 'method', ''))) = 'credit'
            THEN 'credit_installment' ELSE lower(trim(COALESCE(v_pay ->> 'method', 'pix'))) END,
        v_fin_origin,
        'Venda PDV' || CASE WHEN v_seller_name IS NOT NULL THEN ' — ' || v_seller_name ELSE '' END,
        v_now,
        CASE WHEN lower(trim(COALESCE(v_pay ->> 'method', ''))) = ANY (
                ARRAY['credit', 'boleto', 'cheque', 'promissoria']::text[]
            )
            THEN 'pending'::text ELSE 'received'::text END,
        CASE WHEN nullif(trim(COALESCE(v_pay ->> 'due_date', '')), '') IS NOT NULL
            THEN (trim(v_pay ->> 'due_date'))::date ELSE NULL END,
        CASE WHEN lower(trim(COALESCE(v_pay ->> 'method', ''))) = ANY (
                ARRAY['credit', 'boleto', 'cheque', 'promissoria']::text[]
            )
            THEN NULL ELSE v_now END
    FROM jsonb_array_elements(v_payments) AS p2(v_pay);

    RETURN jsonb_build_object('ok', true, 'sale_id', v_sale_id, 'order_id', v_oid);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_finalize_sale(
    p_company_id uuid,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.rpc_finalize_pdv_order(p_company_id, p_payload);
$$;

-- ─── Grants (service_role apenas) ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.rpc_admin_cancel_order(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_cancel_order(uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_admin_assign_driver(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_assign_driver(uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_upsert_customer_with_primary_address(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_customer_with_primary_address(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_upsert_expense(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_expense(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_pay_bill(uuid, uuid, numeric, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_pay_bill(uuid, uuid, numeric, text, date) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_open_cash_register(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_cash_register(uuid, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_close_cash_register(uuid, uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_cash_register(uuid, uuid, numeric, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_upsert_driver(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_driver(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_toggle_driver_active(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_toggle_driver_active(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_delete_driver(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_delete_driver(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_finalize_pdv_order(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_pdv_order(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_finalize_sale(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_sale(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.rpc_finalize_pdv_order(uuid, jsonb) IS
    'Fecha venda PDV: sales, itens, pagamentos, pedido (novo ou ativo), financial_entries — transação única.';

