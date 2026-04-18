-- No máximo 4 endereços por cliente e empresa (enderecos_cliente).

CREATE OR REPLACE FUNCTION public.rpc_chatbot_pro_create_customer_address(
    p_company_id   uuid,
    p_customer_id  uuid,
    p_payload      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_id          uuid;
    v_apelido     text;
    v_principal   boolean;
    v_log         text;
    v_num         text;
    v_bai         text;
    v_cid         text;
    v_est         text;
    v_cnt         int;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = p_customer_id
          AND c.company_id = p_company_id
    ) THEN
        RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT COUNT(*)::int
    INTO v_cnt
    FROM public.enderecos_cliente e
    WHERE e.customer_id = p_customer_id
      AND e.company_id = p_company_id;

    IF v_cnt >= 4 THEN
        RAISE EXCEPTION 'max_enderecos_por_cliente'
            USING ERRCODE = 'P0001',
                  MESSAGE = 'Limite de 4 enderecos por cliente atingido.';
    END IF;

    v_apelido   := COALESCE(nullif(trim(COALESCE(p_payload ->> 'apelido', '')), ''), 'WhatsApp');
    v_principal := COALESCE((p_payload ->> 'is_principal')::boolean, true);

    v_log := nullif(trim(COALESCE(p_payload ->> 'logradouro', '')), '');
    v_num := nullif(trim(COALESCE(p_payload ->> 'numero', '')), '');
    v_bai := nullif(trim(COALESCE(p_payload ->> 'bairro', '')), '');
    v_cid := nullif(trim(COALESCE(p_payload ->> 'cidade', '')), '');
    v_est := upper(nullif(trim(COALESCE(p_payload ->> 'estado', '')), ''));

    IF v_log IS NULL OR v_num IS NULL OR v_bai IS NULL OR v_cid IS NULL OR v_est IS NULL THEN
        RAISE EXCEPTION 'address_fields_required'
            USING ERRCODE = 'P0001',
                  MESSAGE = 'Obrigatorio: logradouro, numero, bairro, cidade e estado (UF).';
    END IF;

    IF length(v_est) NOT IN (2) THEN
        RAISE EXCEPTION 'estado_invalido'
            USING ERRCODE = 'P0001',
                  MESSAGE = 'Estado (UF) deve ter 2 letras.';
    END IF;

    INSERT INTO public.enderecos_cliente (
        company_id,
        customer_id,
        apelido,
        logradouro,
        numero,
        complemento,
        bairro,
        cidade,
        estado,
        cep,
        is_principal
    )
    VALUES (
        p_company_id,
        p_customer_id,
        v_apelido,
        v_log,
        v_num,
        nullif(trim(COALESCE(p_payload ->> 'complemento', '')), ''),
        v_bai,
        v_cid,
        v_est,
        nullif(trim(COALESCE(p_payload ->> 'cep', '')), ''),
        v_principal
    )
    RETURNING id INTO v_id;

    IF v_principal THEN
        UPDATE public.enderecos_cliente
        SET is_principal = false
        WHERE customer_id = p_customer_id
          AND company_id = p_company_id
          AND id <> v_id
          AND length(btrim(COALESCE(logradouro, ''))) > 0
          AND length(btrim(COALESCE(numero, ''))) > 0
          AND length(btrim(COALESCE(bairro, ''))) > 0
          AND length(btrim(COALESCE(cidade, ''))) > 0
          AND length(btrim(COALESCE(estado, ''))) = 2;

        UPDATE public.enderecos_cliente
        SET is_principal = true
        WHERE id = v_id
          AND customer_id = p_customer_id
          AND company_id = p_company_id;
    END IF;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_chatbot_pro_upsert_endereco_cliente(
    p_company_id   uuid,
    p_customer_id  uuid,
    p_payload      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_id          uuid;
    v_apelido     text;
    v_principal   boolean;
    v_cnt         int;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = p_customer_id
          AND c.company_id = p_company_id
    ) THEN
        RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;

    v_apelido   := COALESCE(nullif(trim(COALESCE(p_payload ->> 'apelido', '')), ''), 'WhatsApp');
    v_principal := COALESCE((p_payload ->> 'is_principal')::boolean, true);

    IF nullif(trim(COALESCE(p_payload ->> 'address_id', '')), '') IS NOT NULL THEN
        v_id := (trim(p_payload ->> 'address_id'))::uuid;
        UPDATE public.enderecos_cliente
        SET
            apelido      = COALESCE(nullif(trim(COALESCE(p_payload ->> 'apelido', '')), ''), apelido),
            logradouro   = nullif(trim(COALESCE(p_payload ->> 'logradouro', '')), ''),
            numero       = nullif(trim(COALESCE(p_payload ->> 'numero', '')), ''),
            complemento  = nullif(trim(COALESCE(p_payload ->> 'complemento', '')), ''),
            bairro       = nullif(trim(COALESCE(p_payload ->> 'bairro', '')), ''),
            cidade       = nullif(trim(COALESCE(p_payload ->> 'cidade', '')), ''),
            estado       = nullif(trim(COALESCE(p_payload ->> 'estado', '')), ''),
            cep          = nullif(trim(COALESCE(p_payload ->> 'cep', '')), ''),
            is_principal = v_principal
        WHERE id = v_id
          AND customer_id = p_customer_id
          AND company_id = p_company_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'address_not_found' USING ERRCODE = 'P0002';
        END IF;
    ELSE
        SELECT e.id
        INTO v_id
        FROM public.enderecos_cliente e
        WHERE e.customer_id = p_customer_id
          AND e.company_id = p_company_id
          AND e.apelido = v_apelido
        LIMIT 1;

        IF v_id IS NOT NULL THEN
            UPDATE public.enderecos_cliente
            SET
                logradouro   = nullif(trim(COALESCE(p_payload ->> 'logradouro', '')), ''),
                numero       = nullif(trim(COALESCE(p_payload ->> 'numero', '')), ''),
                complemento  = nullif(trim(COALESCE(p_payload ->> 'complemento', '')), ''),
                bairro       = nullif(trim(COALESCE(p_payload ->> 'bairro', '')), ''),
                cidade       = nullif(trim(COALESCE(p_payload ->> 'cidade', '')), ''),
                estado       = nullif(trim(COALESCE(p_payload ->> 'estado', '')), ''),
                cep          = nullif(trim(COALESCE(p_payload ->> 'cep', '')), ''),
                is_principal = v_principal
            WHERE id = v_id;
        ELSE
            SELECT COUNT(*)::int
            INTO v_cnt
            FROM public.enderecos_cliente e
            WHERE e.customer_id = p_customer_id
              AND e.company_id = p_company_id;

            IF v_cnt >= 4 THEN
                RAISE EXCEPTION 'max_enderecos_por_cliente'
                    USING ERRCODE = 'P0001',
                          MESSAGE = 'Limite de 4 enderecos por cliente atingido.';
            END IF;

            INSERT INTO public.enderecos_cliente (
                company_id,
                customer_id,
                apelido,
                logradouro,
                numero,
                complemento,
                bairro,
                cidade,
                estado,
                cep,
                is_principal
            )
            VALUES (
                p_company_id,
                p_customer_id,
                v_apelido,
                nullif(trim(COALESCE(p_payload ->> 'logradouro', '')), ''),
                nullif(trim(COALESCE(p_payload ->> 'numero', '')), ''),
                nullif(trim(COALESCE(p_payload ->> 'complemento', '')), ''),
                nullif(trim(COALESCE(p_payload ->> 'bairro', '')), ''),
                nullif(trim(COALESCE(p_payload ->> 'cidade', '')), ''),
                nullif(trim(COALESCE(p_payload ->> 'estado', '')), ''),
                nullif(trim(COALESCE(p_payload ->> 'cep', '')), ''),
                v_principal
            )
            RETURNING id INTO v_id;
        END IF;
    END IF;

    IF v_principal THEN
        UPDATE public.enderecos_cliente
        SET is_principal = false
        WHERE customer_id = p_customer_id
          AND company_id = p_company_id
          AND id <> v_id
          AND length(btrim(COALESCE(logradouro, ''))) > 0
          AND length(btrim(COALESCE(numero, ''))) > 0
          AND length(btrim(COALESCE(bairro, ''))) > 0
          AND length(btrim(COALESCE(cidade, ''))) > 0
          AND length(btrim(COALESCE(estado, ''))) = 2;

        UPDATE public.enderecos_cliente
        SET is_principal = true
        WHERE id = v_id
          AND customer_id = p_customer_id
          AND company_id = p_company_id;
    END IF;

    RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.rpc_chatbot_pro_create_customer_address(uuid, uuid, jsonb) IS
    'Insere endereco (max 4 por cliente); sincroniza is_principal sem atualizar linhas que violam delivery_core_chk.';

COMMENT ON FUNCTION public.rpc_chatbot_pro_upsert_endereco_cliente(uuid, uuid, jsonb) IS
    'Upsert endereco (INSERT respeita max 4 por cliente); principal como create.';

GRANT EXECUTE ON FUNCTION public.rpc_chatbot_pro_create_customer_address(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_chatbot_pro_upsert_endereco_cliente(uuid, uuid, jsonb) TO service_role;
