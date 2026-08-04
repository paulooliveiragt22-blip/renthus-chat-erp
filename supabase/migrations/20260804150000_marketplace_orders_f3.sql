-- F3: pedidos inbound marketplace + fontes/canais.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_source_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_source_check
  CHECK (source = ANY (ARRAY[
    'chatbot'::text,
    'ui'::text,
    'pdv_direct'::text,
    'flow_catalog'::text,
    'flow_checkout'::text,
    'ai_chat_pro_v2'::text,
    'web_menu'::text,
    'marketplace_ifood'::text,
    'marketplace_aiqfome'::text
  ]));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_channel_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_channel_check
  CHECK (channel = ANY (ARRAY[
    'whatsapp'::text,
    'admin'::text,
    'balcao'::text,
    'web'::text,
    'marketplace'::text
  ]));

CREATE TABLE IF NOT EXISTS public.marketplace_external_orders (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    provider             text NOT NULL CHECK (provider = ANY (ARRAY['ifood'::text, 'aiqfome'::text])),
    external_order_id    text NOT NULL,
    order_id             uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
    external_status      text NULL,
    last_pushed_status   text NULL,
    display_id           text NULL,
    raw_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT marketplace_external_orders_uidx UNIQUE (company_id, provider, external_order_id)
);

CREATE INDEX IF NOT EXISTS marketplace_external_orders_order_idx
    ON public.marketplace_external_orders (company_id, order_id);

ALTER TABLE public.marketplace_external_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_external_orders_member_all ON public.marketplace_external_orders;
CREATE POLICY marketplace_external_orders_member_all
    ON public.marketplace_external_orders FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = marketplace_external_orders.company_id
              AND cu.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = marketplace_external_orders.company_id
              AND cu.user_id = auth.uid()
        )
    );

INSERT INTO public.features (key, description)
SELECT 'marketplace_orders', 'Pedidos inbound de marketplaces (iFood/Aiqfome)'
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'features'
)
ON CONFLICT DO NOTHING;

INSERT INTO public.plan_features (plan_id, feature_key)
SELECT p.id, 'marketplace_orders'
FROM public.plans p
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_features')
  AND EXISTS (SELECT 1 FROM public.features WHERE key = 'marketplace_orders')
ON CONFLICT DO NOTHING;
