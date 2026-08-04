-- F4.1: sync automático de catálogo marketplace (cron 1–6h).

ALTER TABLE public.marketplace_connections
    ADD COLUMN IF NOT EXISTS auto_sync_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS sync_interval_hours int NOT NULL DEFAULT 3;

ALTER TABLE public.marketplace_connections
    DROP CONSTRAINT IF EXISTS marketplace_connections_sync_interval_hours_chk;

ALTER TABLE public.marketplace_connections
    ADD CONSTRAINT marketplace_connections_sync_interval_hours_chk
        CHECK (sync_interval_hours BETWEEN 1 AND 6);

COMMENT ON COLUMN public.marketplace_connections.auto_sync_enabled IS
    'Quando true, o cron /api/marketplace/sync-catalog re-sincroniza o catálogo.';
COMMENT ON COLUMN public.marketplace_connections.sync_interval_hours IS
    'Intervalo mínimo entre syncs automáticos (1–6 horas).';

COMMENT ON TABLE public.marketplace_connections IS
    'Conexão por empresa com marketplace (tokens cifrados; sync manual ou cron opcional).';
