-- Núcleo obrigatório de entrega em enderecos_cliente (alinhado a
-- public.rpc_chatbot_pro_create_customer_address e validações do Flow).
-- NOT VALID: não reescaneia linhas existentes; INSERT/UPDATE passam a exigir o CHECK.
-- Depois de corrigir dados legados: ALTER TABLE public.enderecos_cliente
--   VALIDATE CONSTRAINT enderecos_cliente_delivery_core_chk;

ALTER TABLE public.enderecos_cliente
  DROP CONSTRAINT IF EXISTS enderecos_cliente_delivery_core_chk;

ALTER TABLE public.enderecos_cliente
  ADD CONSTRAINT enderecos_cliente_delivery_core_chk CHECK (
    length(btrim(COALESCE(logradouro, ''))) > 0
    AND length(btrim(COALESCE(numero, ''))) > 0
    AND length(btrim(COALESCE(bairro, ''))) > 0
    AND length(btrim(COALESCE(cidade, ''))) > 0
    AND length(btrim(COALESCE(estado, ''))) = 2
  ) NOT VALID;

COMMENT ON CONSTRAINT enderecos_cliente_delivery_core_chk ON public.enderecos_cliente IS
  'Logradouro, numero, bairro e cidade nao vazios; UF com 2 caracteres (trim). CEP/complemento opcionais. '
  'Criado NOT VALID; rodar VALIDATE CONSTRAINT apos backfill de linhas antigas.';
