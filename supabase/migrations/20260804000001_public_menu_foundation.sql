-- F0 Cardápio web público: profile por empresa, show_on_menu, events, RPC de leitura.

-- ─── 1. company_menu_profile ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_menu_profile (
    company_id      uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    slug            text NOT NULL,
    display_name    text NOT NULL,
    tagline         text NULL,
    logo_url        text NULL,
    whatsapp_phone  text NULL,
    is_active       boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT company_menu_profile_slug_format_chk
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 2 AND 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_menu_profile_slug_lower_uidx
    ON public.company_menu_profile (lower(slug));

COMMENT ON TABLE public.company_menu_profile IS
    'Perfil do cardápio web público (/c/[slug]). is_active=false = link offline.';

-- Seed a partir de companies existentes (inativo até o lojista ativar)
INSERT INTO public.company_menu_profile (company_id, slug, display_name, whatsapp_phone, is_active)
SELECT
    c.id,
    COALESCE(
        NULLIF(regexp_replace(lower(trim(COALESCE(c.slug, ''))), '[^a-z0-9]+', '-', 'g'), ''),
        NULLIF(regexp_replace(lower(trim(COALESCE(c.nome_fantasia, c.name, ''))), '[^a-z0-9]+', '-', 'g'), ''),
        'loja-' || substr(replace(c.id::text, '-', ''), 1, 8)
    ) AS slug,
    COALESCE(NULLIF(trim(c.nome_fantasia), ''), NULLIF(trim(c.name), ''), 'Cardápio') AS display_name,
    COALESCE(NULLIF(trim(c.whatsapp_phone), ''), NULLIF(trim(c.phone), '')) AS whatsapp_phone,
    false
FROM public.companies c
WHERE NOT EXISTS (
    SELECT 1 FROM public.company_menu_profile p WHERE p.company_id = c.id
)
ON CONFLICT DO NOTHING;

-- Resolve colisões de slug no seed (sufixo curto do company_id)
UPDATE public.company_menu_profile p
SET slug = p.slug || '-' || substr(replace(p.company_id::text, '-', ''), 1, 6)
WHERE p.company_id IN (
    SELECT company_id
    FROM (
        SELECT company_id, lower(slug) AS s,
               ROW_NUMBER() OVER (PARTITION BY lower(slug) ORDER BY company_id) AS rn
        FROM public.company_menu_profile
    ) d
    WHERE d.rn > 1
);

ALTER TABLE public.company_menu_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_menu_profile_member_select ON public.company_menu_profile;
CREATE POLICY company_menu_profile_member_select
    ON public.company_menu_profile FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = company_menu_profile.company_id
              AND cu.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS company_menu_profile_member_update ON public.company_menu_profile;
CREATE POLICY company_menu_profile_member_update
    ON public.company_menu_profile FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = company_menu_profile.company_id
              AND cu.user_id = auth.uid()
              AND cu.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS company_menu_profile_member_insert ON public.company_menu_profile;
CREATE POLICY company_menu_profile_member_insert
    ON public.company_menu_profile FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = company_menu_profile.company_id
              AND cu.user_id = auth.uid()
              AND cu.role IN ('owner', 'admin')
        )
    );

-- ─── 2. products.show_on_menu ────────────────────────────────────────────────
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS show_on_menu boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.show_on_menu IS
    'Se false, produto ativo não aparece no cardápio web público.';

-- ─── 3. menu_page_events (analytics leve, sem PII) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_page_events (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    slug          text NOT NULL,
    visitor_id    uuid NOT NULL,
    event_type    text NOT NULL,
    product_id    uuid NULL,
    category_id   uuid NULL,
    embalagem_id  uuid NULL,
    utm_source    text NULL,
    utm_medium    text NULL,
    utm_campaign  text NULL,
    referrer      text NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT menu_page_events_type_chk
        CHECK (event_type IN ('page_view', 'product_view', 'category_view'))
);

CREATE INDEX IF NOT EXISTS menu_page_events_company_created_idx
    ON public.menu_page_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS menu_page_events_slug_created_idx
    ON public.menu_page_events (lower(slug), created_at DESC);

ALTER TABLE public.menu_page_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS menu_page_events_member_select ON public.menu_page_events;
CREATE POLICY menu_page_events_member_select
    ON public.menu_page_events FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.company_id = menu_page_events.company_id
              AND cu.user_id = auth.uid()
        )
    );

-- Inserts públicos só via service_role (API server)

-- ─── 4. Feature web_menu ────────────────────────────────────────────────────
INSERT INTO public.features (key, description)
SELECT 'web_menu', 'Cardápio web público com fotos e preços'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'features')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.plan_features (plan_id, feature_key)
SELECT p.id, 'web_menu'
FROM public.plans p
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_features')
  AND EXISTS (SELECT 1 FROM public.features WHERE key = 'web_menu')
ON CONFLICT DO NOTHING;

-- ─── 5. RPC leitura pública (service_role) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_get_public_menu(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slug   text := lower(trim(COALESCE(p_slug, '')));
    v_prof   public.company_menu_profile%ROWTYPE;
    v_city   text;
    v_uf     text;
    v_items  jsonb;
BEGIN
    IF v_slug = '' OR char_length(v_slug) < 2 THEN
        RETURN jsonb_build_object('error', 'menu_not_found');
    END IF;

    SELECT * INTO v_prof
    FROM public.company_menu_profile
    WHERE lower(slug) = v_slug
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'menu_not_found');
    END IF;

    IF NOT v_prof.is_active THEN
        RETURN jsonb_build_object('error', 'menu_inactive');
    END IF;

    SELECT c.cidade, c.uf INTO v_city, v_uf
    FROM public.companies c
    WHERE c.id = v_prof.company_id;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'embalagem_id',   x.embalagem_id,
                'product_id',     x.product_id,
                'category_id',    x.category_id,
                'category_name',  x.category_name,
                'name',           x.name,
                'description',    x.description,
                'price',          x.price,
                'sigla',          x.sigla,
                'thumbnail_url',  x.thumbnail_url,
                'image_url',      x.image_url,
                'in_stock',       x.in_stock,
                'category_sort',  x.category_sort
            )
            ORDER BY x.category_sort, x.category_name NULLS LAST, x.name
        ),
        '[]'::jsonb
    )
    INTO v_items
    FROM (
        SELECT
            pe.id                                              AS embalagem_id,
            p.id                                               AS product_id,
            p.category_id                                      AS category_id,
            cat.name                                           AS category_name,
            COALESCE(NULLIF(trim(p.name), ''), 'Produto')      AS name,
            NULLIF(trim(COALESCE(pe.descricao, '')), '')       AS description,
            pe.preco_venda                                     AS price,
            COALESCE(sc.sigla, 'UN')                           AS sigla,
            COALESCE(piv.thumbnail_url, pip.thumbnail_url)     AS thumbnail_url,
            COALESCE(piv.url, pip.url)                         AS image_url,
            COALESCE(p.estoque_atual, 0) > 0                   AS in_stock,
            CASE WHEN cat.name IS NULL THEN 999 ELSE 0 END     AS category_sort
        FROM public.products p
        INNER JOIN public.produto_embalagens pe
            ON pe.produto_id = p.id
        LEFT JOIN public.siglas_comerciais sc
            ON sc.id = pe.id_sigla_comercial
        LEFT JOIN public.categories cat
            ON cat.id = p.category_id
        LEFT JOIN LATERAL (
            SELECT pi.url, pi.thumbnail_url
            FROM public.product_images pi
            WHERE pi.product_id = p.id
              AND pi.product_volume_id IS NOT DISTINCT FROM pe.product_volume_id
              AND pi.is_primary = true
            ORDER BY pi.created_at DESC
            LIMIT 1
        ) piv ON true
        LEFT JOIN LATERAL (
            SELECT pi.url, pi.thumbnail_url
            FROM public.product_images pi
            WHERE pi.product_id = p.id
              AND pi.product_volume_id IS NULL
              AND pi.is_primary = true
            ORDER BY pi.created_at DESC
            LIMIT 1
        ) pip ON true
        WHERE p.company_id = v_prof.company_id
          AND COALESCE(p.is_active, true) = true
          AND COALESCE(p.show_on_menu, true) = true
          AND pe.preco_venda IS NOT NULL
          AND pe.preco_venda > 0
          AND (
              sc.sigla IS NULL
              OR upper(sc.sigla) = 'UN'
              OR NOT EXISTS (
                  SELECT 1
                  FROM public.produto_embalagens pe2
                  INNER JOIN public.siglas_comerciais sc2 ON sc2.id = pe2.id_sigla_comercial
                  WHERE pe2.produto_id = p.id
                    AND upper(sc2.sigla) = 'UN'
                    AND pe2.preco_venda IS NOT NULL
                    AND pe2.preco_venda > 0
              )
          )
    ) x;

    RETURN jsonb_build_object(
        'store', jsonb_build_object(
            'company_id',     v_prof.company_id,
            'slug',           v_prof.slug,
            'display_name',   v_prof.display_name,
            'tagline',        v_prof.tagline,
            'logo_url',       v_prof.logo_url,
            'whatsapp_phone', v_prof.whatsapp_phone,
            'city',           v_city,
            'state',          v_uf,
            'is_active',      v_prof.is_active
        ),
        'items', v_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_public_menu(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_public_menu(text) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_record_menu_page_event(
    p_slug         text,
    p_visitor_id   uuid,
    p_event_type   text,
    p_product_id   uuid DEFAULT NULL,
    p_category_id  uuid DEFAULT NULL,
    p_embalagem_id uuid DEFAULT NULL,
    p_utm_source   text DEFAULT NULL,
    p_utm_medium   text DEFAULT NULL,
    p_utm_campaign text DEFAULT NULL,
    p_referrer     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slug text := lower(trim(COALESCE(p_slug, '')));
    v_company_id uuid;
    v_id uuid;
BEGIN
    IF v_slug = '' OR p_visitor_id IS NULL THEN
        RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
    END IF;
    IF p_event_type NOT IN ('page_view', 'product_view', 'category_view') THEN
        RAISE EXCEPTION 'invalid_event_type' USING ERRCODE = '22023';
    END IF;

    SELECT company_id INTO v_company_id
    FROM public.company_menu_profile
    WHERE lower(slug) = v_slug AND is_active = true
    LIMIT 1;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'menu_not_found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.menu_page_events (
        company_id, slug, visitor_id, event_type,
        product_id, category_id, embalagem_id,
        utm_source, utm_medium, utm_campaign, referrer
    ) VALUES (
        v_company_id, v_slug, p_visitor_id, p_event_type,
        p_product_id, p_category_id, p_embalagem_id,
        NULLIF(trim(COALESCE(p_utm_source, '')), ''),
        NULLIF(trim(COALESCE(p_utm_medium, '')), ''),
        NULLIF(trim(COALESCE(p_utm_campaign, '')), ''),
        NULLIF(left(trim(COALESCE(p_referrer, '')), 500), '')
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_record_menu_page_event(
    text, uuid, text, uuid, uuid, uuid, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_record_menu_page_event(
    text, uuid, text, uuid, uuid, uuid, text, text, text, text
) TO service_role;
