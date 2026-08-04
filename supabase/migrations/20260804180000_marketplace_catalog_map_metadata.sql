-- F4.4: metadados de option groups iFood no mapa de catálogo.

ALTER TABLE public.marketplace_catalog_map
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.marketplace_catalog_map.metadata IS
    'Metadados do item externo (ex.: optionGroups iFood) sem PII.';
