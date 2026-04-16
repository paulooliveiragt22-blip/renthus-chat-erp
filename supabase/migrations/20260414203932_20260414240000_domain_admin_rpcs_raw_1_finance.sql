-- Fragmento de 20260414240000_domain_admin_rpcs.sql alinhado ao registo remoto em supabase_migrations (split MCP).

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
