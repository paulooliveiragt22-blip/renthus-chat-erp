-- Chatbot PRO: upsert de endereço do cliente (sem INSERT direto no app).
-- Colunas alinhadas a public.enderecos_cliente (apelido, logradouro, numero, complemento, bairro, cidade, estado, cep, is_principal).

CREATE OR REPLACE FUNCTION public.rpc_chatbot_pro_upsert_endereco_cliente(
    p_company_id   uuid,
    p_customer_id  uuid,
    p_payload      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id          uuid;
    v_apelido     text;
    v_principal   boolean;
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
            apelido     = COALESCE(nullif(trim(COALESCE(p_payload ->> 'apelido', '')), ''), apelido),
            logradouro  = nullif(trim(COALESCE(p_payload ->> 'logradouro', '')), ''),
            numero      = nullif(trim(COALESCE(p_payload ->> 'numero', '')), ''),
            complemento = nullif(trim(COALESCE(p_payload ->> 'complemento', '')), ''),
            bairro      = nullif(trim(COALESCE(p_payload ->> 'bairro', '')), ''),
            cidade      = nullif(trim(COALESCE(p_payload ->> 'cidade', '')), ''),
            estado      = nullif(trim(COALESCE(p_payload ->> 'estado', '')), ''),
            cep         = nullif(trim(COALESCE(p_payload ->> 'cep', '')), ''),
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
                logradouro  = nullif(trim(COALESCE(p_payload ->> 'logradouro', '')), ''),
                numero      = nullif(trim(COALESCE(p_payload ->> 'numero', '')), ''),
                complemento = nullif(trim(COALESCE(p_payload ->> 'complemento', '')), ''),
                bairro      = nullif(trim(COALESCE(p_payload ->> 'bairro', '')), ''),
                cidade      = nullif(trim(COALESCE(p_payload ->> 'cidade', '')), ''),
                estado      = nullif(trim(COALESCE(p_payload ->> 'estado', '')), ''),
                cep         = nullif(trim(COALESCE(p_payload ->> 'cep', '')), ''),
                is_principal = v_principal
            WHERE id = v_id;
        ELSE
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
          AND id IS DISTINCT FROM v_id;

        UPDATE public.enderecos_cliente
        SET is_principal = true
        WHERE id = v_id;
    END IF;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_chatbot_pro_upsert_endereco_cliente(uuid, uuid, jsonb) TO service_role;
