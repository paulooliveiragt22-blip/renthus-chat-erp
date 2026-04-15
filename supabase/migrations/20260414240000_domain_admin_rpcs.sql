-- RPCs de domínio (admin/service_role): pedidos, clientes+endereço, financeiro, caixa, entregadores, PDV.
-- Alinhadas ao comportamento das rotas Next existentes (transação onde aplicável).

-- ─── Pedidos ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_admin_cancel_order(
    p_company_id uuid,
    p_order_id uuid,
    p_reject_confirmation boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now timestamptz := now();
BEGIN
    UPDATE public.orders
    SET
        status = 'canceled',
        confirmation_status = CASE
            WHEN p_reject_confirmation THEN 'rejected'::text
            ELSE confirmation_status
        END,
        confirmed_at = CASE
            WHEN p_reject_confirmation THEN v_now
            ELSE confirmed_at
        END
    WHERE id = p_order_id
      AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_assign_driver(
    p_company_id uuid,
    p_order_id uuid,
    p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_driver_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.drivers d
            WHERE d.id = p_driver_id AND d.company_id = p_company_id
        ) THEN
            RAISE EXCEPTION 'driver_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    UPDATE public.orders
    SET driver_id = p_driver_id
    WHERE id = p_order_id
      AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- ─── Cliente + endereço principal ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_upsert_customer_with_primary_address(
    p_company_id uuid,
    p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_c       jsonb := p_payload -> 'customer';
    v_a       jsonb := p_payload -> 'address';
    v_id      uuid;
    v_name    text;
    v_phone   text;
    v_addr_id uuid;
BEGIN
    IF v_c IS NULL THEN
        RAISE EXCEPTION 'customer_payload_required' USING ERRCODE = '23502';
    END IF;

    v_name  := nullif(trim(COALESCE(v_c ->> 'name', '')), '');
    v_phone := nullif(trim(COALESCE(v_c ->> 'phone', '')), '');
    IF v_name IS NULL OR v_phone IS NULL THEN
        RAISE EXCEPTION 'name_phone_required' USING ERRCODE = '23502';
    END IF;

    IF nullif(trim(COALESCE(v_c ->> 'id', '')), '') IS NOT NULL THEN
        v_id := (trim(v_c ->> 'id'))::uuid;
        UPDATE public.customers
        SET
            name           = v_name,
            phone          = v_phone,
            email          = nullif(trim(COALESCE(v_c ->> 'email', '')), ''),
            cpf_cnpj       = nullif(trim(COALESCE(v_c ->> 'cpf_cnpj', '')), ''),
            tipo_pessoa    = COALESCE(nullif(trim(COALESCE(v_c ->> 'tipo_pessoa', '')), ''), 'PF'),
            limite_credito = COALESCE((v_c ->> 'limite_credito')::numeric, 0),
            notes          = nullif(trim(COALESCE(v_c ->> 'notes', '')), '')
        WHERE id = v_id AND company_id = p_company_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
        END IF;
    ELSE
        INSERT INTO public.customers (
            company_id, origem, name, phone, email, cpf_cnpj, tipo_pessoa, limite_credito, notes
        )
        VALUES (
            p_company_id,
            COALESCE(nullif(trim(COALESCE(v_c ->> 'origem', '')), ''), 'admin'),
            v_name,
            v_phone,
            nullif(trim(COALESCE(v_c ->> 'email', '')), ''),
            nullif(trim(COALESCE(v_c ->> 'cpf_cnpj', '')), ''),
            COALESCE(nullif(trim(COALESCE(v_c ->> 'tipo_pessoa', '')), ''), 'PF'),
            COALESCE((v_c ->> 'limite_credito')::numeric, 0),
            nullif(trim(COALESCE(v_c ->> 'notes', '')), '')
        )
        RETURNING id INTO v_id;
    END IF;

    IF v_a IS NOT NULL AND (
        nullif(trim(COALESCE(v_a ->> 'logradouro', '')), '') IS NOT NULL
        OR nullif(trim(COALESCE(v_a ->> 'bairro', '')), '') IS NOT NULL
        OR nullif(trim(COALESCE(v_a ->> 'cidade', '')), '') IS NOT NULL
    ) THEN
        IF COALESCE((v_a ->> 'is_principal')::boolean, false) THEN
            UPDATE public.enderecos_cliente
            SET is_principal = false
            WHERE customer_id = v_id AND company_id = p_company_id;
        END IF;

        IF nullif(trim(COALESCE(v_a ->> 'address_id', '')), '') IS NOT NULL THEN
            v_addr_id := (trim(v_a ->> 'address_id'))::uuid;
            UPDATE public.enderecos_cliente
            SET
                apelido     = COALESCE(nullif(trim(COALESCE(v_a ->> 'apelido', '')), ''), apelido),
                logradouro  = nullif(trim(COALESCE(v_a ->> 'logradouro', '')), ''),
                numero      = nullif(trim(COALESCE(v_a ->> 'numero', '')), ''),
                complemento = nullif(trim(COALESCE(v_a ->> 'complemento', '')), ''),
                bairro      = nullif(trim(COALESCE(v_a ->> 'bairro', '')), ''),
                cidade      = nullif(trim(COALESCE(v_a ->> 'cidade', '')), ''),
                estado      = nullif(trim(COALESCE(v_a ->> 'estado', '')), ''),
                cep         = nullif(trim(COALESCE(v_a ->> 'cep', '')), ''),
                is_principal = COALESCE((v_a ->> 'is_principal')::boolean, is_principal)
            WHERE id = v_addr_id AND customer_id = v_id AND company_id = p_company_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'address_not_found' USING ERRCODE = 'P0002';
            END IF;
        ELSE
            INSERT INTO public.enderecos_cliente (
                company_id, customer_id, apelido, logradouro, numero, complemento,
                bairro, cidade, estado, cep, is_principal
            )
            VALUES (
                p_company_id,
                v_id,
                COALESCE(nullif(trim(COALESCE(v_a ->> 'apelido', '')), ''), 'Endereço'),
                nullif(trim(COALESCE(v_a ->> 'logradouro', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'numero', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'complemento', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'bairro', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'cidade', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'estado', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'cep', '')), ''),
                COALESCE((v_a ->> 'is_principal')::boolean, false)
            );
        END IF;

        UPDATE public.customers c
        SET
            address      = COALESCE(
                nullif(
                    trim(concat_ws(', ',
                        nullif(trim(COALESCE(v_a ->> 'logradouro', '')), ''),
                        CASE WHEN nullif(trim(COALESCE(v_a ->> 'numero', '')), '') IS NOT NULL
                            THEN 'nº ' || trim(v_a ->> 'numero') END,
                        nullif(trim(COALESCE(v_a ->> 'bairro', '')), '')
                    )),
                    ''
                ),
                c.address
            ),
            neighborhood = COALESCE(nullif(trim(COALESCE(v_a ->> 'bairro', '')), ''), c.neighborhood)
        WHERE c.id = v_id AND c.company_id = p_company_id;
    END IF;

    RETURN v_id;
END;
$$;

-- ─── Despesas ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_upsert_expense(
    p_company_id uuid,
    p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF COALESCE(trim(p_payload ->> 'action'), '') = 'mark_paid' THEN
        v_id := (trim(p_payload ->> 'id'))::uuid;
        UPDATE public.expenses
        SET payment_status = 'paid', paid_at = now()
        WHERE id = v_id AND company_id = p_company_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002';
        END IF;
        RETURN v_id;
    END IF;

    IF nullif(trim(COALESCE(p_payload ->> 'id', '')), '') IS NULL THEN
        INSERT INTO public.expenses (
            company_id, category, description, amount, due_date, payment_status, paid_at
        )
        VALUES (
            p_company_id,
            trim(COALESCE(p_payload ->> 'category', '')),
            trim(COALESCE(p_payload ->> 'description', '')),
            COALESCE((p_payload ->> 'amount')::numeric, 0),
            (trim(p_payload ->> 'due_date'))::date,
            COALESCE(nullif(trim(COALESCE(p_payload ->> 'payment_status', '')), ''), 'pending'),
            CASE WHEN COALESCE(nullif(trim(p_payload ->> 'payment_status'), ''), 'pending') = 'paid'
                THEN now() ELSE NULL END
        )
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    v_id := (trim(p_payload ->> 'id'))::uuid;
    UPDATE public.expenses
    SET
        category        = COALESCE(nullif(trim(COALESCE(p_payload ->> 'category', '')), ''), category),
        description     = COALESCE(nullif(trim(COALESCE(p_payload ->> 'description', '')), ''), description),
        amount          = COALESCE((p_payload ->> 'amount')::numeric, amount),
        due_date        = COALESCE((trim(p_payload ->> 'due_date'))::date, due_date),
        payment_status  = COALESCE(nullif(trim(COALESCE(p_payload ->> 'payment_status', '')), ''), payment_status),
        paid_at         = CASE
            WHEN COALESCE(nullif(trim(COALESCE(p_payload ->> 'payment_status', '')), ''), payment_status) = 'paid'
                THEN COALESCE(paid_at, now())
            ELSE paid_at
        END
    WHERE id = v_id AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_id;
END;
$$;

-- ─── Baixa em título (bills) ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_pay_bill(
    p_company_id uuid,
    p_bill_id uuid,
    p_pay_amount numeric,
    p_payment_method text,
    p_received_at date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_orig       numeric;
    v_saldo      numeric;
    v_amt        numeric;
    v_new_paid   numeric;
    v_pm         text := COALESCE(nullif(trim(p_payment_method), ''), 'pix');
BEGIN
    SELECT b.original_amount, b.saldo_devedor, b.amount
    INTO v_orig, v_saldo, v_amt
    FROM public.bills b
    WHERE b.id = p_bill_id AND b.company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bill_not_found' USING ERRCODE = 'P0002';
    END IF;

    v_new_paid := v_orig - v_saldo + COALESCE(p_pay_amount, 0);

    UPDATE public.bills
    SET
        amount_paid      = v_new_paid,
        payment_method   = v_pm,
        paid_at          = CASE
            WHEN v_new_paid >= v_amt AND p_received_at IS NOT NULL
                THEN timezone('UTC', (p_received_at::timestamp + interval '12 hours'))
            ELSE paid_at
        END
    WHERE id = p_bill_id AND company_id = p_company_id;
END;
$$;

-- ─── Caixa ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_open_cash_register(
    p_company_id uuid,
    p_operator_name text,
    p_initial_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.cash_registers (
        company_id, operator_name, initial_amount, status, opened_at
    )
    VALUES (
        p_company_id,
        nullif(trim(COALESCE(p_operator_name, '')), ''),
        COALESCE(p_initial_amount, 0),
        'open',
        now()
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_close_cash_register(
    p_company_id uuid,
    p_register_id uuid,
    p_closing_amount numeric,
    p_balance_expected numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_counted numeric := COALESCE(p_closing_amount, 0);
    v_exp     numeric := COALESCE(p_balance_expected, 0);
BEGIN
    UPDATE public.cash_registers
    SET
        status          = 'closed',
        closed_at       = now(),
        closing_amount  = v_counted,
        difference      = v_counted - v_exp
    WHERE id = p_register_id
      AND company_id = p_company_id
      AND status = 'open';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash_register_invalid' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

-- ─── Entregadores ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_upsert_driver(
    p_company_id uuid,
    p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id   uuid;
    v_name text := nullif(trim(COALESCE(p_payload ->> 'name', '')), '');
BEGIN
    IF nullif(trim(COALESCE(p_payload ->> 'id', '')), '') IS NULL THEN
        IF v_name IS NULL THEN
            RAISE EXCEPTION 'name_required' USING ERRCODE = '23502';
        END IF;
        INSERT INTO public.drivers (
            company_id, name, phone, vehicle, plate, notes, is_active
        )
        VALUES (
            p_company_id,
            v_name,
            nullif(trim(COALESCE(p_payload ->> 'phone', '')), ''),
            nullif(trim(COALESCE(p_payload ->> 'vehicle', '')), ''),
            nullif(trim(COALESCE(p_payload ->> 'plate', '')), ''),
            nullif(trim(COALESCE(p_payload ->> 'notes', '')), ''),
            COALESCE((p_payload ->> 'is_active')::boolean, true)
        )
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    v_id := (trim(p_payload ->> 'id'))::uuid;
    UPDATE public.drivers
    SET
        name      = CASE WHEN p_payload ? 'name' THEN nullif(trim(COALESCE(p_payload ->> 'name', '')), '') ELSE name END,
        phone     = CASE WHEN p_payload ? 'phone' THEN nullif(trim(COALESCE(p_payload ->> 'phone', '')), '') ELSE phone END,
        vehicle   = CASE WHEN p_payload ? 'vehicle' THEN nullif(trim(COALESCE(p_payload ->> 'vehicle', '')), '') ELSE vehicle END,
        plate     = CASE WHEN p_payload ? 'plate' THEN nullif(trim(COALESCE(p_payload ->> 'plate', '')), '') ELSE plate END,
        notes     = CASE WHEN p_payload ? 'notes' THEN nullif(trim(COALESCE(p_payload ->> 'notes', '')), '') ELSE notes END,
        is_active = CASE WHEN p_payload ? 'is_active' THEN (p_payload ->> 'is_active')::boolean ELSE is_active END
    WHERE id = v_id AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'driver_not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_toggle_driver_active(
    p_company_id uuid,
    p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.drivers
    SET is_active = NOT COALESCE(is_active, true)
    WHERE id = p_driver_id AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'driver_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_delete_driver(
    p_company_id uuid,
    p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.drivers
    WHERE id = p_driver_id AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'driver_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

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
