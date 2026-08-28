-- Match por dígitos normalizados; grava phone como (DD) 9XXXXXXXX; merge só se já existir.

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
    v_raw     text := NULLIF(btrim(COALESCE(p_phone, '')), '');
    v_e164    text := NULLIF(btrim(COALESCE(p_phone_e164, '')), '');
    v_digits  text;
    v_display text;
    v_wa_ext  text;
    v_target  uuid;
    v_exists  uuid;
BEGIN
    IF p_company_id IS NULL OR p_customer_id IS NULL OR v_raw IS NULL THEN
        RAISE EXCEPTION 'link_phone_params_required' USING ERRCODE = '23502';
    END IF;

    v_digits := regexp_replace(v_raw, '\D', '', 'g');
    IF length(v_digits) > 11 AND left(v_digits, 2) = '55' THEN
        v_digits := substring(v_digits from 3);
    END IF;

    IF length(v_digits) <> 11 OR substring(v_digits, 3, 1) <> '9' THEN
        RAISE EXCEPTION 'phone_invalid' USING ERRCODE = '23514';
    END IF;

    IF v_e164 IS NULL THEN
        v_e164 := '+55' || v_digits;
    END IF;

    v_display := '(' || left(v_digits, 2) || ') ' || substring(v_digits from 3);
    v_wa_ext := v_e164;

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
          (v_e164 IS NOT NULL AND c.phone_e164 = v_e164)
          OR regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') = v_digits
          OR (
              c.phone_e164 IS NOT NULL
              AND regexp_replace(c.phone_e164, '\D', '', 'g') = regexp_replace(v_e164, '\D', '', 'g')
          )
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
        phone = v_display,
        phone_e164 = v_e164
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
