-- Chatbot / Flows: INSERT validado em enderecos_cliente (rua, número, bairro, cidade, estado obrigatórios; CEP opcional).
-- SECURITY DEFINER; uso apenas server-side (service_role).

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
        SET is_principal = (id = v_id)
        WHERE customer_id = p_customer_id
          AND company_id = p_company_id;
    END IF;

    RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_chatbot_pro_create_customer_address(uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.rpc_chatbot_pro_create_customer_address(uuid, uuid, jsonb) IS
    'Insere endereço do cliente com validação mínima (logradouro, numero, bairro, cidade, estado/UF2, cep opcional).';
