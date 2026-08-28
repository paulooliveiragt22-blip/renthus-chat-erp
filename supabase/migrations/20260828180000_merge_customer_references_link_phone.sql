-- Merge omnichannel: reponta todas as FKs antes de apagar stub IG/Messenger.
-- Corrige link_phone_failed quando chatbot_sessions (e outras FKs NO ACTION) bloqueiam DELETE.

CREATE OR REPLACE FUNCTION public.reassign_customer_references(
    p_company_id uuid,
    p_from       uuid,
    p_to         uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_company_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
        RETURN;
    END IF;

    UPDATE public.customer_channel_identities
    SET customer_id = p_to, updated_at = now()
    WHERE company_id = p_company_id AND customer_id = p_from;

    UPDATE public.orders
    SET customer_id = p_to
    WHERE company_id = p_company_id AND customer_id = p_from;

    UPDATE public.enderecos_cliente
    SET customer_id = p_to
    WHERE customer_id = p_from;

    UPDATE public.chatbot_sessions
    SET customer_id = p_to, updated_at = now()
    WHERE customer_id = p_from;

    UPDATE public.abandoned_carts
    SET customer_id = p_to
    WHERE company_id = p_company_id AND customer_id = p_from;

    UPDATE public.support_tickets
    SET customer_id = p_to
    WHERE company_id = p_company_id AND customer_id = p_from;

    UPDATE public.table_sessions
    SET customer_id = p_to
    WHERE company_id = p_company_id AND customer_id = p_from;

    UPDATE public.broadcast_campaign_recipients
    SET customer_id = p_to
    WHERE customer_id = p_from;

    UPDATE public.whatsapp_order_confirmations
    SET customer_id = p_to
    WHERE company_id = p_company_id AND customer_id = p_from;

    UPDATE public.customer_message_consents
    SET customer_id = p_to
    WHERE company_id = p_company_id AND customer_id = p_from;

    UPDATE public.sales
    SET customer_id = p_to
    WHERE customer_id = p_from;

    UPDATE public.sale_payments
    SET customer_id = p_to
    WHERE customer_id = p_from;

    UPDATE public.bills
    SET customer_id = p_to
    WHERE customer_id = p_from;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_customer_references(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_customer_references(uuid, uuid, uuid) TO service_role;

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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raw     text := NULLIF(btrim(COALESCE(p_phone, '')), '');
    v_e164    text := NULLIF(btrim(COALESCE(p_phone_e164, '')), '');
    v_digits  text;
    v_display text;
    v_wa_ext  text;
    v_target  uuid;
    v_exists  uuid;
    v_owner   uuid;
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

    -- Cliente canônico com mesmo telefone (match por E.164 ou dígitos)
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

    -- Identidade WA já aponta para outro customer (fallback se phone no cadastro divergir)
    IF v_exists IS NULL THEN
        SELECT i.customer_id INTO v_exists
        FROM public.customer_channel_identities i
        WHERE i.company_id = p_company_id
          AND i.channel = 'whatsapp'
          AND i.external_id = v_wa_ext
          AND i.customer_id <> v_target
        LIMIT 1;
    END IF;

    IF v_exists IS NOT NULL THEN
        PERFORM public.reassign_customer_references(p_company_id, v_target, v_exists);

        DELETE FROM public.customers
        WHERE id = v_target AND company_id = p_company_id;

        customer_id := v_exists;
        merged := true;
        from_customer_id := v_target;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Telefone novo: grava formato nacional + E.164 no stub/canal
    UPDATE public.customers
    SET
        phone = v_display,
        phone_e164 = v_e164
    WHERE id = v_target AND company_id = p_company_id;

    SELECT i.customer_id INTO v_owner
    FROM public.customer_channel_identities i
    WHERE i.company_id = p_company_id
      AND i.channel = 'whatsapp'
      AND i.external_id = v_wa_ext
    LIMIT 1;

    IF v_owner IS NOT NULL AND v_owner <> v_target THEN
        PERFORM public.reassign_customer_references(p_company_id, v_target, v_owner);
        DELETE FROM public.customers
        WHERE id = v_target AND company_id = p_company_id;
        customer_id := v_owner;
        merged := true;
        from_customer_id := v_target;
        RETURN NEXT;
        RETURN;
    END IF;

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
