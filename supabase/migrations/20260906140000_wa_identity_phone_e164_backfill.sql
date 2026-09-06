-- B13/hotfix: WhatsApp identity com external_id sem '+' gravava phone_e164 NULL
-- e podia marcar needs_phone em clientes antigos. Sempre normaliza E.164 no insert/update.

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
    v_wa_e164      text;
    v_wa_national  text;
BEGIN
    IF p_company_id IS NULL OR v_channel = '' OR v_ext = '' THEN
        RAISE EXCEPTION 'identity_params_required' USING ERRCODE = '23502';
    END IF;

    IF v_channel NOT IN ('whatsapp', 'instagram', 'messenger', 'web') THEN
        RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '23514';
    END IF;

    v_origem := COALESCE(NULLIF(btrim(COALESCE(p_origem, '')), ''), 'chatbot');
    v_new_name := NULLIF(btrim(COALESCE(p_name, '')), '');

    -- Canonical WA phone for insert/backfill (digits → +55…)
    IF v_channel = 'whatsapp' THEN
        v_wa_e164 := CASE
            WHEN v_ext LIKE '+%' THEN v_ext
            WHEN regexp_replace(v_ext, '\D', '', 'g') ~ '^55\d{10,11}$' THEN
                '+' || regexp_replace(v_ext, '\D', '', 'g')
            WHEN length(regexp_replace(v_ext, '\D', '', 'g')) BETWEEN 10 AND 11 THEN
                '+55' || regexp_replace(v_ext, '\D', '', 'g')
            ELSE NULL
        END;
        IF v_wa_e164 IS NOT NULL THEN
            v_wa_national := '(' || substr(regexp_replace(v_wa_e164, '\D', '', 'g'), 3, 2)
                || ') ' || substr(regexp_replace(v_wa_e164, '\D', '', 'g'), 5);
        END IF;
    END IF;

    SELECT i.customer_id INTO v_cid
    FROM public.customer_channel_identities i
    WHERE i.company_id = p_company_id
      AND i.channel = v_channel
      AND i.external_id = v_ext
    LIMIT 1;

    -- Também casa identity se o token veio com +E.164 e o cadastro antigo sem +
    IF v_cid IS NULL AND v_channel = 'whatsapp' AND v_wa_e164 IS NOT NULL THEN
        SELECT i.customer_id INTO v_cid
        FROM public.customer_channel_identities i
        WHERE i.company_id = p_company_id
          AND i.channel = 'whatsapp'
          AND public.br_mobile_digits_canonical(i.external_id)
            = public.br_mobile_digits_canonical(v_wa_e164)
        LIMIT 1;
    END IF;

    IF v_cid IS NOT NULL THEN
        SELECT c.phone, c.phone_e164, c.name INTO v_phone, v_phone_e164, v_current_name
        FROM public.customers c
        WHERE c.id = v_cid;

        IF v_channel = 'whatsapp' AND v_wa_e164 IS NOT NULL
           AND (v_phone_e164 IS NULL OR btrim(v_phone_e164) = '') THEN
            UPDATE public.customers
            SET phone_e164 = v_wa_e164,
                phone = COALESCE(NULLIF(btrim(phone), ''), v_wa_national, v_ext)
            WHERE id = v_cid
              AND company_id = p_company_id;
            v_phone_e164 := v_wa_e164;
            v_phone := COALESCE(NULLIF(btrim(v_phone), ''), v_wa_national, v_ext);
        END IF;

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
        IF v_channel = 'whatsapp' THEN
            needs_phone := false;
        ELSE
            needs_phone := (
                (v_phone IS NULL OR btrim(v_phone) = '')
                AND (v_phone_e164 IS NULL OR btrim(v_phone_e164) = '')
            );
        END IF;
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
            VALUES (p_company_id, v_cid, v_channel, COALESCE(v_wa_e164, v_ext))
            ON CONFLICT (company_id, channel, external_id) DO NOTHING;

            IF v_wa_e164 IS NOT NULL THEN
                UPDATE public.customers
                SET phone_e164 = COALESCE(NULLIF(btrim(phone_e164), ''), v_wa_e164),
                    phone = COALESCE(NULLIF(btrim(phone), ''), v_wa_national, v_ext)
                WHERE id = v_cid
                  AND company_id = p_company_id;
            END IF;

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
            COALESCE(v_wa_national, v_ext),
            v_wa_e164,
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
    VALUES (p_company_id, v_cid, v_channel, COALESCE(v_wa_e164, v_ext));

    customer_id := v_cid;
    is_new := v_new;
    needs_phone := (v_channel <> 'whatsapp');
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) TO service_role;
