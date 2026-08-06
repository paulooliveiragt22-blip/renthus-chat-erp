-- P0d: identidade omnichannel — phone opcional + customer_channel_identities.
-- Decisões: B1 telefone obrigatório no 1º checkout IG; B2 merge automático por phone.

-- ─── 1. customers.phone nullable + unique parcial ─────────────────────────────

ALTER TABLE public.customers
    ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.customers
    DROP CONSTRAINT IF EXISTS customers_company_id_phone_key;

DROP INDEX IF EXISTS public.customers_company_id_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS customers_company_phone_uq
    ON public.customers (company_id, phone)
    WHERE phone IS NOT NULL AND btrim(phone) <> '';

-- origem: liberar web_menu / canais Meta (resolveWebCustomer já tentava web_menu)
ALTER TABLE public.customers
    DROP CONSTRAINT IF EXISTS customers_origem_check;

ALTER TABLE public.customers
    ADD CONSTRAINT customers_origem_check
    CHECK (
        origem IS NULL
        OR origem = ANY (
            ARRAY[
                'chatbot'::text,
                'admin'::text,
                'web_menu'::text,
                'instagram'::text,
                'messenger'::text,
                'whatsapp'::text,
                'pdv'::text
            ]
        )
    );

-- ─── 2. customer_channel_identities ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.customer_channel_identities (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   uuid        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    customer_id  uuid        NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
    channel      text        NOT NULL
                 CHECK (channel = ANY (ARRAY[
                     'whatsapp'::text,
                     'instagram'::text,
                     'messenger'::text,
                     'web'::text
                 ])),
    external_id  text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_channel_identities_company_channel_external_uq
        UNIQUE (company_id, channel, external_id)
);

CREATE INDEX IF NOT EXISTS customer_channel_identities_customer_idx
    ON public.customer_channel_identities (customer_id);

CREATE INDEX IF NOT EXISTS customer_channel_identities_company_idx
    ON public.customer_channel_identities (company_id, channel);

ALTER TABLE public.customer_channel_identities ENABLE ROW LEVEL SECURITY;

-- Leitura autenticada por empresa (mesmo padrão multi-tenant via company_users)
DROP POLICY IF EXISTS customer_channel_identities_select_company ON public.customer_channel_identities;
CREATE POLICY customer_channel_identities_select_company
    ON public.customer_channel_identities
    FOR SELECT
    TO authenticated
    USING (
        company_id IN (
            SELECT cu.company_id
            FROM public.company_users cu
            WHERE cu.user_id = auth.uid()
        )
    );

-- Mutação só via service role / RPC SECURITY DEFINER (sem policy INSERT/UPDATE/DELETE para authenticated)

COMMENT ON TABLE public.customer_channel_identities IS
    'Identidade por canal: (company, channel, external_id) → customer_id. WA=phone E.164, IG=IGSID, Messenger=PSID.';

-- ─── 3. Backfill WhatsApp a partir de customers existentes ────────────────────

INSERT INTO public.customer_channel_identities (company_id, customer_id, channel, external_id)
SELECT
    c.company_id,
    c.id,
    'whatsapp',
    COALESCE(NULLIF(btrim(c.phone_e164), ''), NULLIF(btrim(c.phone), ''))
FROM public.customers c
WHERE COALESCE(NULLIF(btrim(c.phone_e164), ''), NULLIF(btrim(c.phone), '')) IS NOT NULL
ON CONFLICT (company_id, channel, external_id) DO NOTHING;

-- ─── 4. RPC: resolve ou cria por identidade de canal ──────────────────────────

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
    v_channel text := lower(btrim(COALESCE(p_channel, '')));
    v_ext     text := btrim(COALESCE(p_external_id, ''));
    v_cid     uuid;
    v_phone   text;
    v_new     boolean := false;
    v_origem  text;
BEGIN
    IF p_company_id IS NULL OR v_channel = '' OR v_ext = '' THEN
        RAISE EXCEPTION 'identity_params_required' USING ERRCODE = '23502';
    END IF;

    IF v_channel NOT IN ('whatsapp', 'instagram', 'messenger', 'web') THEN
        RAISE EXCEPTION 'invalid_channel' USING ERRCODE = '23514';
    END IF;

    v_origem := COALESCE(NULLIF(btrim(COALESCE(p_origem, '')), ''), 'chatbot');

    SELECT i.customer_id INTO v_cid
    FROM public.customer_channel_identities i
    WHERE i.company_id = p_company_id
      AND i.channel = v_channel
      AND i.external_id = v_ext
    LIMIT 1;

    IF v_cid IS NOT NULL THEN
        SELECT c.phone INTO v_phone FROM public.customers c WHERE c.id = v_cid;
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
            COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), 'Cliente WhatsApp'),
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
            COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), 'Cliente'),
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

REVOKE ALL ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_customer_by_identity(uuid, text, text, text, text) TO service_role;

-- ─── 5. RPC: vincular telefone (merge automático se phone já existe) ──────────

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
    v_target  uuid;
    v_exists  uuid;
BEGIN
    IF p_company_id IS NULL OR p_customer_id IS NULL OR v_phone IS NULL THEN
        RAISE EXCEPTION 'link_phone_params_required' USING ERRCODE = '23502';
    END IF;

    v_digits := regexp_replace(v_phone, '\D', '', 'g');

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
        -- Merge: identidades e pedidos do stub → cliente existente; apaga stub
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

    -- Identidade WhatsApp espelhando o phone (para unificar canais depois)
    INSERT INTO public.customer_channel_identities (company_id, customer_id, channel, external_id)
    VALUES (
        p_company_id,
        v_target,
        'whatsapp',
        COALESCE(v_e164, CASE WHEN v_phone LIKE '+%' THEN v_phone ELSE v_digits END)
    )
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
