
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
