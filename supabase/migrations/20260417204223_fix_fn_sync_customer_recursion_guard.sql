-- Quebra ciclo enderecos_cliente <-> customers (stack depth 54001):
-- fn_sync_address_to_customer atualiza customers -> trg_sync_customer ->
-- fn_sync_customer_to_enderecos faz INSERT em enderecos -> trg_sync_address de novo.
-- Com pg_trigger_depth() > 1 não inserimos "Chatbot" quando o UPDATE em customers veio de trigger aninhado.

CREATE OR REPLACE FUNCTION public.fn_sync_customer_to_enderecos()
    RETURNS trigger
    LANGUAGE plpgsql
AS $function$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    IF NEW.address IS NOT NULL AND (OLD.address IS DISTINCT FROM NEW.address) THEN
        INSERT INTO public.enderecos_cliente (
            company_id,
            customer_id,
            apelido,
            logradouro,
            bairro,
            is_principal
        )
        VALUES (
            NEW.company_id,
            NEW.id,
            'Chatbot',
            NEW.address,
            NEW.neighborhood,
            TRUE
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$function$;
