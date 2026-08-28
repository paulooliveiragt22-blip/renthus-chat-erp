-- Atualiza nome do cliente quando identidade IG/Messenger já existe e o nome atual é genérico.

CREATE OR REPLACE FUNCTION public.is_generic_customer_display_name(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
        NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL
        OR lower(btrim(p_name)) IN (
            'cliente',
            'cliente instagram',
            'cliente messenger',
            'cliente whatsapp'
        ),
        false
    );
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
SET search_path = public
AS $$
DECLARE
    v_channel      text := lower(btrim(COALESCE(p_channel, '')));
    v_ext          text := btrim(COALESCE(p_external_id, ''));
    v_cid          uuid;
    v_phone        text;
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
        SELECT c.phone, c.name INTO v_phone, v_current_name
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
        needs_phone := (v_phone IS NULL OR btrim(v_phone) = '');
        RETURN NEXT;
        RETURN;
    END IF;

    -- WhatsApp: tentar casar customer existente pelo telefone
    IF v_channel = 'whatsapp' THEN
        SELECT c.id, c.phone INTO v_cid, v_phone
        FROM public.customers c
        WHERE c.company_id = p_company_id
          AND (
              c.phone_e164 = v_ext
              OR c.phone = v_ext
              OR c.phone = regexp_replace(v_ext, '\D', '', 'g')
          )
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
        -- IG / Messenger / web sem phone ainda
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

REVOKE ALL ON FUNCTION public.is_generic_customer_display_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_generic_customer_display_name(text) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) TO service_role;
