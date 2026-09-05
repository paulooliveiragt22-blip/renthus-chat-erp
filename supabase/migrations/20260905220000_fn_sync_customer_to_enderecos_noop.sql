-- customers.address (texto livre) NÃO deve inventar linha em enderecos_cliente
-- sem núcleo de entrega (logradouro/numero/bairro/cidade/UF).
-- Antes: trigger inseria só logradouro+bairro → violava enderecos_cliente_delivery_core_chk
-- ao salvar cliente no Pedidos (order-customers UPDATE address).

CREATE OR REPLACE FUNCTION public.fn_sync_customer_to_enderecos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
    -- Evita recursão com fn_sync_address_to_customer
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    -- Cache em customers.address é livre; enderecos_cliente exige estrutura.
    -- Não materializar endereço a partir de texto livre / neighborhood parcial.
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_sync_customer_to_enderecos() IS
  'No-op: customers.address é cache; INSERT estruturado só via API/RPC de enderecos_cliente '
  '(delivery_core_chk). Antes criava linha incompleta e quebrava Pedidos.';
