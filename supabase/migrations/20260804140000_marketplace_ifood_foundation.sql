-- F1: fundação sync marketplace (iFood primeiro).

CREATE TABLE IF NOT EXISTS public.marketplace_connections (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    provider                text NOT NULL CHECK (provider = ANY (ARRAY['ifood'::text, 'aiqfome'::text])),
    merchant_id             text NOT NULL DEFAULT '',
    encrypted_access_token  text NULL,
    encrypted_refresh_token text NULL,
    status                  text NOT NULL DEFAULT 'disconnected'
        CHECK (status = ANY (ARRAY[
            'disconnected'::text, 'connected'::text, 'error'::text, 'syncing'::text
        ])),
    use_mock                boolean NOT NULL DEFAULT true,
    last_sync_at            timestamptz NULL,
    last_error              text NULL,
    last_sync_created       int NOT NULL DEFAULT 0,
    last_sync_updated       int NOT NULL DEFAULT 0,
    last_sync_skipped       int NOT NULL DEFAULT 0,
    last_sync_images        int NOT NULL DEFAULT 0,
    last_sync_errors        int NOT NULL DEFAULT 0,
    metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT marketplace_connections_company_provider_uidx UNIQUE (company_id, provider)
);

COMMENT ON TABLE public.marketplace_connections IS
    'Conexão por empresa com marketplace (tokens cifrados; sync manual).';

CREATE TABLE IF NOT EXISTS public.marketplace_catalog_map (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    provider             text NOT NULL CHECK (provider = ANY (ARRAY['ifood'::text, 'aiqfome'::text])),
    external_item_id     text NOT NULL,
    external_product_id  text NULL,
    product_id           uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
    produto_embalagem_id uuid NULL REFERENCES public.produto_embalagens(id) ON DELETE SET NULL,
    category_id          uuid NULL REFERENCES public.categories(id) ON DELETE SET NULL,
    last_synced_at       timestamptz NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT marketplace_catalog_map_uidx UNIQUE (company_id, provider, external_item_id)
);

CREATE INDEX IF NOT EXISTS marketplace_catalog_map_product_idx
    ON public.marketplace_catalog_map (company_id, product_id);

ALTER TABLE public.marketplace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_catalog_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_connections_member_all ON public.marketplace_connections;
CREATE POLICY marketplace_connections_member_all
    ON public.marketplace_connections FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = marketplace_connections.company_id
              AND cu.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = marketplace_connections.company_id
              AND cu.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS marketplace_catalog_map_member_all ON public.marketplace_catalog_map;
CREATE POLICY marketplace_catalog_map_member_all
    ON public.marketplace_catalog_map FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = marketplace_catalog_map.company_id
              AND cu.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = marketplace_catalog_map.company_id
              AND cu.user_id = auth.uid()
        )
    );

INSERT INTO public.features (key, description)
SELECT 'marketplace_ifood', 'Importação/sincronização de cardápio iFood'
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'features'
)
ON CONFLICT DO NOTHING;

INSERT INTO public.plan_features (plan_id, feature_key)
SELECT p.id, 'marketplace_ifood'
FROM public.plans p
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_features')
  AND EXISTS (SELECT 1 FROM public.features WHERE key = 'marketplace_ifood')
ON CONFLICT DO NOTHING;
