-- Fragmento de 20260414240000_domain_admin_rpcs.sql alinhado ao registo remoto em supabase_migrations (split MCP).

-- ─── Cliente + endereço principal ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_upsert_customer_with_primary_address(
    p_company_id uuid,
    p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_c       jsonb := p_payload -> 'customer';
    v_a       jsonb := p_payload -> 'address';
    v_id      uuid;
    v_name    text;
    v_phone   text;
    v_addr_id uuid;
BEGIN
    IF v_c IS NULL THEN
        RAISE EXCEPTION 'customer_payload_required' USING ERRCODE = '23502';
    END IF;

    v_name  := nullif(trim(COALESCE(v_c ->> 'name', '')), '');
    v_phone := nullif(trim(COALESCE(v_c ->> 'phone', '')), '');
    IF v_name IS NULL OR v_phone IS NULL THEN
        RAISE EXCEPTION 'name_phone_required' USING ERRCODE = '23502';
    END IF;

    IF nullif(trim(COALESCE(v_c ->> 'id', '')), '') IS NOT NULL THEN
        v_id := (trim(v_c ->> 'id'))::uuid;
        UPDATE public.customers
        SET
            name           = v_name,
            phone          = v_phone,
            email          = nullif(trim(COALESCE(v_c ->> 'email', '')), ''),
            cpf_cnpj       = nullif(trim(COALESCE(v_c ->> 'cpf_cnpj', '')), ''),
            tipo_pessoa    = COALESCE(nullif(trim(COALESCE(v_c ->> 'tipo_pessoa', '')), ''), 'PF'),
            limite_credito = COALESCE((v_c ->> 'limite_credito')::numeric, 0),
            notes          = nullif(trim(COALESCE(v_c ->> 'notes', '')), '')
        WHERE id = v_id AND company_id = p_company_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
        END IF;
    ELSE
        INSERT INTO public.customers (
            company_id, origem, name, phone, email, cpf_cnpj, tipo_pessoa, limite_credito, notes
        )
        VALUES (
            p_company_id,
            COALESCE(nullif(trim(COALESCE(v_c ->> 'origem', '')), ''), 'admin'),
            v_name,
            v_phone,
            nullif(trim(COALESCE(v_c ->> 'email', '')), ''),
            nullif(trim(COALESCE(v_c ->> 'cpf_cnpj', '')), ''),
            COALESCE(nullif(trim(COALESCE(v_c ->> 'tipo_pessoa', '')), ''), 'PF'),
            COALESCE((v_c ->> 'limite_credito')::numeric, 0),
            nullif(trim(COALESCE(v_c ->> 'notes', '')), '')
        )
        RETURNING id INTO v_id;
    END IF;

    IF v_a IS NOT NULL AND (
        nullif(trim(COALESCE(v_a ->> 'logradouro', '')), '') IS NOT NULL
        OR nullif(trim(COALESCE(v_a ->> 'bairro', '')), '') IS NOT NULL
        OR nullif(trim(COALESCE(v_a ->> 'cidade', '')), '') IS NOT NULL
    ) THEN
        IF COALESCE((v_a ->> 'is_principal')::boolean, false) THEN
            UPDATE public.enderecos_cliente
            SET is_principal = false
            WHERE customer_id = v_id AND company_id = p_company_id;
        END IF;

        IF nullif(trim(COALESCE(v_a ->> 'address_id', '')), '') IS NOT NULL THEN
            v_addr_id := (trim(v_a ->> 'address_id'))::uuid;
            UPDATE public.enderecos_cliente
            SET
                apelido     = COALESCE(nullif(trim(COALESCE(v_a ->> 'apelido', '')), ''), apelido),
                logradouro  = nullif(trim(COALESCE(v_a ->> 'logradouro', '')), ''),
                numero      = nullif(trim(COALESCE(v_a ->> 'numero', '')), ''),
                complemento = nullif(trim(COALESCE(v_a ->> 'complemento', '')), ''),
                bairro      = nullif(trim(COALESCE(v_a ->> 'bairro', '')), ''),
                cidade      = nullif(trim(COALESCE(v_a ->> 'cidade', '')), ''),
                estado      = nullif(trim(COALESCE(v_a ->> 'estado', '')), ''),
                cep         = nullif(trim(COALESCE(v_a ->> 'cep', '')), ''),
                is_principal = COALESCE((v_a ->> 'is_principal')::boolean, is_principal)
            WHERE id = v_addr_id AND customer_id = v_id AND company_id = p_company_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'address_not_found' USING ERRCODE = 'P0002';
            END IF;
        ELSE
            INSERT INTO public.enderecos_cliente (
                company_id, customer_id, apelido, logradouro, numero, complemento,
                bairro, cidade, estado, cep, is_principal
            )
            VALUES (
                p_company_id,
                v_id,
                COALESCE(nullif(trim(COALESCE(v_a ->> 'apelido', '')), ''), 'Endereço'),
                nullif(trim(COALESCE(v_a ->> 'logradouro', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'numero', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'complemento', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'bairro', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'cidade', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'estado', '')), ''),
                nullif(trim(COALESCE(v_a ->> 'cep', '')), ''),
                COALESCE((v_a ->> 'is_principal')::boolean, false)
            );
        END IF;

        UPDATE public.customers c
        SET
            address      = COALESCE(
                nullif(
                    trim(concat_ws(', ',
                        nullif(trim(COALESCE(v_a ->> 'logradouro', '')), ''),
                        CASE WHEN nullif(trim(COALESCE(v_a ->> 'numero', '')), '') IS NOT NULL
                            THEN 'nº ' || trim(v_a ->> 'numero') END,
                        nullif(trim(COALESCE(v_a ->> 'bairro', '')), '')
                    )),
                    ''
                ),
                c.address
            ),
            neighborhood = COALESCE(nullif(trim(COALESCE(v_a ->> 'bairro', '')), ''), c.neighborhood)
        WHERE c.id = v_id AND c.company_id = p_company_id;
    END IF;

    RETURN v_id;
END;
$$;
