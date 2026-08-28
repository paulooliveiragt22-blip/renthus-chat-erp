-- Corrige external_id da identidade WhatsApp no link de telefone (E.164 canônico).

CREATE OR REPLACE FUNCTION public.link_customer_channel_phone(
    p_company_id  uuid,
    p_customer_id uuid,
    p_phone       text,
    p_phone_e164  text DEFAULT NULL
)
RETURNS TABLE (
    customer_id uuid,
    merged      boolean,
    from_customer_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone   text := NULLIF(btrim(COALESCE(p_phone, '')), '');
    v_e164    text := NULLIF(btrim(COALESCE(p_phone_e164, '')), '');
    v_digits  text;
    v_wa_ext  text;
    v_target  uuid;
    v_exists  uuid;
BEGIN
    IF p_company_id IS NULL OR p_customer_id IS NULL OR v_phone IS NULL THEN
        RAISE EXCEPTION 'link_phone_params_required' USING ERRCODE = '23502';
    END IF;

    v_digits := regexp_replace(v_phone, '\D', '', 'g');

    IF v_e164 IS NULL THEN
        IF v_phone LIKE '+%' THEN
            v_e164 := v_phone;
        ELSIF length(v_digits) BETWEEN 10 AND 11 THEN
            v_e164 := '+55' || v_digits;
        END IF;
    END IF;

    v_wa_ext := COALESCE(v_e164, v_digits);

    SELECT c.id INTO v_target
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.company_id = p_company_id;

    IF v_target IS NULL THEN
        RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT c.id INTO v_exists
    FROM public.customers c
    WHERE c.company_id = p_company_id
      AND c.id <> v_target
      AND (
          c.phone = v_phone
          OR c.phone = v_digits
          OR (v_e164 IS NOT NULL AND c.phone_e164 = v_e164)
          OR (v_e164 IS NOT NULL AND c.phone = v_e164)
      )
    LIMIT 1;

    IF v_exists IS NOT NULL THEN
        UPDATE public.customer_channel_identities
        SET customer_id = v_exists, updated_at = now()
        WHERE company_id = p_company_id AND customer_id = v_target;

        UPDATE public.orders
        SET customer_id = v_exists
        WHERE company_id = p_company_id AND customer_id = v_target;

        UPDATE public.enderecos_cliente
        SET customer_id = v_exists
        WHERE customer_id = v_target;

        UPDATE public.chatbot_sessions
        SET customer_id = v_exists
        WHERE company_id = p_company_id AND customer_id = v_target;

        DELETE FROM public.customers
        WHERE id = v_target AND company_id = p_company_id;

        customer_id := v_exists;
        merged := true;
        from_customer_id := v_target;
        RETURN NEXT;
        RETURN;
    END IF;

    UPDATE public.customers
    SET
        phone = v_phone,
        phone_e164 = COALESCE(v_e164, phone_e164)
    WHERE id = v_target AND company_id = p_company_id;

    INSERT INTO public.customer_channel_identities (company_id, customer_id, channel, external_id)
    VALUES (p_company_id, v_target, 'whatsapp', v_wa_ext)
    ON CONFLICT (company_id, channel, external_id) DO UPDATE
    SET customer_id = EXCLUDED.customer_id, updated_at = now();

    customer_id := v_target;
    merged := false;
    from_customer_id := NULL;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.link_customer_channel_phone(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_channel_phone(uuid, uuid, text, text) TO service_role;
