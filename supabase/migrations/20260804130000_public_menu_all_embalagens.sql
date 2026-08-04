-- Cardápio web: listar todas as embalagens com preço (UN, CX, FARD…), não só UN.

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
            ORDER BY x.category_sort, x.category_name NULLS LAST, x.name_base, x.sigla_sort, x.name
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
            COALESCE(NULLIF(trim(p.name), ''), 'Produto')      AS name_base,
            CASE
                WHEN upper(COALESCE(sc.sigla, 'UN')) IN ('UN', 'UND', 'UNID')
                    THEN COALESCE(NULLIF(trim(p.name), ''), 'Produto')
                ELSE COALESCE(NULLIF(trim(p.name), ''), 'Produto')
                     || ' (' || COALESCE(sc.sigla, 'CX') || ')'
            END                                                AS name,
            NULLIF(trim(COALESCE(pe.descricao, '')), '')       AS description,
            pe.preco_venda                                     AS price,
            COALESCE(sc.sigla, 'UN')                           AS sigla,
            CASE upper(COALESCE(sc.sigla, 'UN'))
                WHEN 'UN' THEN 0
                WHEN 'UND' THEN 0
                WHEN 'UNID' THEN 0
                WHEN 'CX' THEN 1
                WHEN 'FARD' THEN 2
                WHEN 'PAC' THEN 3
                ELSE 9
            END                                                AS sigla_sort,
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
