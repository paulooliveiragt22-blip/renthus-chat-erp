-- Match telefones BR legados (10 dígitos sem o 9 do celular) com celular canônico (11 dígitos).

CREATE OR REPLACE FUNCTION public.br_mobile_digits_canonical(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    WITH stripped AS (
        SELECT regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g') AS d
    ),
    national AS (
        SELECT CASE
            WHEN length(d) > 11 AND left(d, 2) = '55' THEN substring(d from 3)
            ELSE d
        END AS d
        FROM stripped
    )
    SELECT CASE
        WHEN length(d) = 10 THEN left(d, 2) || '9' || substring(d from 3)
        ELSE d
    END
    FROM national;
$$;

REVOKE ALL ON FUNCTION public.br_mobile_digits_canonical(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.br_mobile_digits_canonical(text) TO service_role;

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

    SELECT c.id INTO v_exists
    FROM public.customers c
    WHERE c.company_id = p_company_id
      AND c.id <> v_target
      AND public.br_mobile_digits_canonical(
              COALESCE(c.phone_e164, c.phone, '')
          ) = v_digits
    LIMIT 1;

    IF v_exists IS NULL THEN
        SELECT i.customer_id INTO v_exists
        FROM public.customer_channel_identities i
        WHERE i.company_id = p_company_id
          AND i.channel = 'whatsapp'
          AND public.br_mobile_digits_canonical(i.external_id) = v_digits
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

    UPDATE public.customers
    SET
        phone = v_display,
        phone_e164 = v_e164
    WHERE id = v_target AND company_id = p_company_id;

    SELECT i.customer_id INTO v_owner
    FROM public.customer_channel_identities i
    WHERE i.company_id = p_company_id
      AND i.channel = 'whatsapp'
      AND public.br_mobile_digits_canonical(i.external_id) = v_digits
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

CREATE OR REPLACE FUNCTION public.resolve_or_create_customer_by_identity(
    p_company_id  uuid,
    p_channel     text,
    p_external_id text,
    p_name        text DEFAULT NULL,
    p_origem      text DEFAULT 'chatbot'
)
RETURNS TABLE (
    customer_id  uuid,
    is_new       boolean,
    needs_phone  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_channel      text := lower(btrim(COALESCE(p_channel, '')));
    v_ext          text := btrim(COALESCE(p_external_id, ''));
    v_cid          uuid;
    v_phone        text;
    v_phone_e164   text;
    v_current_name text;
    v_new_name     text;
    v_new          boolean := false;
    v_origem       text;
BEGIN
    IF p_company_id IS NULL OR v_channel = '' OR v_ext = '' THEN
        RAISE EXCEPTION 'identity_params_required' USING ERRCODE = '23502';
    END IF;

    IF v_channel NOT IN ('whatsapp', 'instagram', 'messenger', 'web') THEN
        RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '23514';
    END IF;

    v_origem := COALESCE(NULLIF(btrim(COALESCE(p_origem, '')), ''), 'chatbot');
    v_new_name := NULLIF(btrim(COALESCE(p_name, '')), '');

    SELECT i.customer_id INTO v_cid
    FROM public.customer_channel_identities i
    WHERE i.company_id = p_company_id
      AND i.channel = v_channel
      AND i.external_id = v_ext
    LIMIT 1;

    IF v_cid IS NOT NULL THEN
        SELECT c.phone, c.phone_e164, c.name INTO v_phone, v_phone_e164, v_current_name
        FROM public.customers c
        WHERE c.id = v_cid;

        IF v_new_name IS NOT NULL
           AND NOT public.is_generic_customer_display_name(v_new_name)
           AND public.is_generic_customer_display_name(v_current_name)
        THEN
            UPDATE public.customers
            SET name = left(v_new_name, 120)
            WHERE id = v_cid
              AND company_id = p_company_id;
        END IF;

        customer_id := v_cid;
        is_new := false;
        needs_phone := (
            (v_phone IS NULL OR btrim(v_phone) = '')
            AND (v_phone_e164 IS NULL OR btrim(v_phone_e164) = '')
        );
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_channel = 'whatsapp' THEN
        SELECT c.id, c.phone INTO v_cid, v_phone
        FROM public.customers c
        WHERE c.company_id = p_company_id
          AND public.br_mobile_digits_canonical(
                  COALESCE(c.phone_e164, c.phone, v_ext)
              ) = public.br_mobile_digits_canonical(v_ext)
        LIMIT 1;

        IF v_cid IS NOT NULL THEN
            INSERT INTO public.customer_channel_identities (company_id, customer_id, channel, external_id)
            VALUES (p_company_id, v_cid, v_channel, v_ext)
            ON CONFLICT (company_id, channel, external_id) DO NOTHING;

            customer_id := v_cid;
            is_new := false;
            needs_phone := false;
            RETURN NEXT;
            RETURN;
        END IF;

        INSERT INTO public.customers (company_id, name, phone, phone_e164, origem)
        VALUES (
            p_company_id,
            COALESCE(v_new_name, 'Cliente WhatsApp'),
            v_ext,
            CASE WHEN v_ext LIKE '+%' THEN v_ext ELSE NULL END,
            v_origem
        )
        RETURNING id INTO v_cid;
        v_new := true;
    ELSE
        INSERT INTO public.customers (company_id, name, phone, origem)
        VALUES (
            p_company_id,
            COALESCE(v_new_name, 'Cliente'),
            NULL,
            CASE
                WHEN v_channel IN ('instagram', 'messenger', 'web_menu', 'web') THEN
                    CASE WHEN v_channel = 'web' THEN 'web_menu' ELSE v_channel END
                ELSE v_origem
            END
        )
        RETURNING id INTO v_cid;
        v_new := true;
    END IF;

    INSERT INTO public.customer_channel_identities (company_id, customer_id, channel, external_id)
    VALUES (p_company_id, v_cid, v_channel, v_ext);

    customer_id := v_cid;
    is_new := v_new;
    needs_phone := (v_channel <> 'whatsapp');
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.link_customer_channel_phone(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_channel_phone(uuid, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) TO service_role;
