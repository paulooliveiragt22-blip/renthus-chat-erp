-- ─── Documentação da estrutura esperada em whatsapp_channels.provider_metadata ──
--
-- O campo provider_metadata (jsonb) deve conter:
-- {
--   "access_token":    "EAAxxxxx",   -- Bearer token da Meta Cloud API (por empresa)
--   "catalog_flow_id": "123456789"   -- ID do Flow de catálogo publicado na Meta
-- }
--
-- A coluna from_identifier já armazena o phone_number_id da Meta.
-- Esses valores substituem as variáveis de ambiente globais para multi-tenancy.

-- Garante que from_identifier seja único por provider (um número = um canal)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_provider_identifier_idx
    ON public.whatsapp_channels (provider, from_identifier);

-- Índice para lookup rápido por phone_number_id no webhook incoming
CREATE INDEX IF NOT EXISTS whatsapp_channels_from_identifier_idx
    ON public.whatsapp_channels (from_identifier)
    WHERE status = 'active';
