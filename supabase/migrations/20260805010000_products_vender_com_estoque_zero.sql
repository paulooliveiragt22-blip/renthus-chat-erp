-- ============================================================
-- products.vender_com_estoque_zero (default TRUE)
-- TRUE  = pode vender / listar mesmo com estoque 0
-- FALSE = chatbot não vende e cardápio web não exibe quando estoque = 0
-- Também: view_chat_produtos passa a expor estoque real (product_volumes)
-- e rpc_get_public_menu usa volumes + a nova flag.
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS vender_com_estoque_zero boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.vender_com_estoque_zero IS
  'Se true (padrão), permite vender com estoque zero. Se false, oculta do cardápio web e bloqueia venda no chatbot quando estoque_atual do volume = 0.';

-- ── view_chat_produtos: estoque + flag ───────────────────────────────────────
CREATE OR REPLACE VIEW public.view_chat_produtos AS
SELECT
  pe.id,
  pe.company_id,
  pe.produto_id,
  pe.id_sigla_comercial,
  pe.descricao,
  pe.fator_conversao,
  pe.preco_venda,
  pe.codigo_interno,
  pe.codigo_barras_ean,
  pe.tags,
  pe.is_acompanhamento,
  pe.volume_quantidade,
  pe.id_unit_type,
  sc.sigla          AS sigla_comercial,
  p.name            AS product_name,
  p.category_id,
  p.is_active,
  p.unit_type       AS product_unit_type,
  p.details         AS product_details,
  ut.sigla          AS unit_type_sigla,
  trim(concat_ws(' ',
    p.name,
    CASE WHEN pe.volume_quantidade > 0 THEN pe.volume_quantidade::text ELSE NULL END,
    ut.sigla,
    p.details,
    pe.tags
  ))                AS tags_auto,
  pe.product_volume_id,
  COALESCE(piv.thumbnail_url, pip.thumbnail_url) AS thumbnail_url,
  COALESCE(piv.url,           pip.url)           AS image_url,
  COALESCE(p.vender_com_estoque_zero, true)      AS vender_com_estoque_zero,
  COALESCE(
    pv.estoque_atual,
    (
      SELECT pv2.estoque_atual
      FROM public.product_volumes pv2
      WHERE pv2.product_id = pe.produto_id
      ORDER BY pv2.volume_quantidade NULLS LAST
      LIMIT 1
    ),
    0
  ) AS estoque_unidades
FROM public.produto_embalagens pe
JOIN public.products          p  ON p.id  = pe.produto_id
JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
LEFT JOIN public.unit_types   ut ON ut.id  = pe.id_unit_type
LEFT JOIN public.product_volumes pv ON pv.id = pe.product_volume_id
LEFT JOIN public.product_images piv
       ON piv.product_volume_id = pe.product_volume_id
      AND piv.is_primary = true
      AND pe.product_volume_id IS NOT NULL
LEFT JOIN public.product_images pip
       ON pip.product_id       = p.id
      AND pip.product_volume_id IS NULL
      AND pip.is_primary = true
WHERE p.is_active = true;

COMMENT ON VIEW public.view_chat_produtos IS
  'Produtos+embalagens para chatbot. Inclui estoque_unidades (product_volumes) e vender_com_estoque_zero.';

-- ── view_produtos_lista: flag no fim ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_produtos_lista AS
WITH un_packs AS (
  SELECT pe.id, pe.company_id, pe.produto_id, pe.descricao, pe.fator_conversao, pe.preco_venda,
         pe.preco_custo, pe.tags, pe.codigo_barras_ean, pe.is_acompanhamento, pe.codigo_interno,
         pe.id_sigla_comercial, pe.id_unit_type, pe.volume_quantidade,
         pe.product_volume_id,
         sc.sigla AS sigla_comercial, ut.sigla AS unit_type_sigla
  FROM produto_embalagens pe
  JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  LEFT JOIN unit_types ut ON ut.id = pe.id_unit_type
  WHERE upper(sc.sigla) IN ('UN', 'UNIDADE')
),
case_packs AS (
  SELECT DISTINCT ON (pe.produto_id)
    pe.id AS case_id, pe.produto_id, pe.descricao AS case_details, pe.fator_conversao AS case_qty,
    pe.preco_venda AS case_price, pe.id_sigla_comercial AS case_sigla_id,
    pe.codigo_interno AS case_codigo_interno
  FROM produto_embalagens pe
  JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  WHERE upper(sc.sigla) IN ('CX', 'CAIXA', 'FARD', 'PAC')
  ORDER BY pe.produto_id, CASE upper(sc.sigla) WHEN 'CX' THEN 1 WHEN 'CAIXA' THEN 2 WHEN 'FARD' THEN 3 ELSE 4 END
)
SELECT
  un.company_id,
  un.id,
  un.produto_id                          AS product_id,
  un.descricao                           AS details,
  un.id_unit_type,
  un.volume_quantidade                   AS volume_value,
  CASE WHEN un.unit_type_sigla = 'L' THEN 'l'
       WHEN un.unit_type_sigla IN ('ml','kg','m') THEN lower(un.unit_type_sigla)
       ELSE 'none' END                   AS unit,
  un.preco_venda                         AS unit_price,
  COALESCE(un.preco_custo, p.preco_custo_unitario) AS cost_price,
  un.tags,
  un.codigo_barras_ean,
  un.is_acompanhamento,
  un.codigo_interno,
  CASE WHEN cp.case_id IS NOT NULL THEN true ELSE false END AS has_case,
  cp.case_id,
  cp.case_qty,
  cp.case_price,
  cp.case_details,
  cp.case_sigla_id,
  cp.case_codigo_interno,
  p.is_active,
  p.name                                 AS product_name,
  p.category_id,
  c.name                                 AS category_name,
  un.product_volume_id,
  COALESCE(pv.estoque_atual, 0)          AS estoque_un,
  CASE WHEN cp.case_qty IS NOT NULL AND cp.case_qty > 0
       THEN FLOOR(COALESCE(pv.estoque_atual, 0) / cp.case_qty)
       ELSE NULL END                     AS estoque_cx,
  COALESCE(p.vender_com_estoque_zero, true) AS vender_com_estoque_zero
FROM un_packs un
JOIN products p ON p.id = un.produto_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN case_packs cp ON cp.produto_id = un.produto_id
LEFT JOIN product_volumes pv ON pv.id = un.product_volume_id;

-- ── rpc_get_product_full: incluir flag ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_get_product_full(p_product_id uuid, p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'category_id', p.category_id, 'is_active', p.is_active,
    'vender_com_estoque_zero', COALESCE(p.vender_com_estoque_zero, true),
    'volumes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'volume_id', pv.id, 'volume_quantidade', pv.volume_quantidade, 'id_unit_type', pv.id_unit_type,
          'unit_sigla', ut.sigla, 'estoque_atual', pv.estoque_atual, 'estoque_minimo', pv.estoque_minimo,
          'items', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'id', pe.id, 'id_sigla_comercial', pe.id_sigla_comercial, 'sigla', sc.sigla,
                'descricao', pe.descricao, 'fator_conversao', pe.fator_conversao, 'preco_venda', pe.preco_venda,
                'preco_custo', pe.preco_custo, 'codigo_interno', pe.codigo_interno, 'codigo_barras_ean', pe.codigo_barras_ean,
                'tags', pe.tags, 'is_acompanhamento', pe.is_acompanhamento
              ) ORDER BY CASE WHEN upper(sc.sigla) IN ('UN','UNIDADE') THEN 0 ELSE 1 END
            ), '[]'::jsonb)
            FROM produto_embalagens pe
            JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
            WHERE pe.product_volume_id = pv.id
          )
        ) ORDER BY pv.volume_quantidade NULLS LAST
      ), '[]'::jsonb)
      FROM product_volumes pv
      LEFT JOIN unit_types ut ON ut.id = pv.id_unit_type
      WHERE pv.product_id = p_product_id AND pv.company_id = p_company_id
    )
  ) INTO v_result
  FROM products p
  WHERE p.id = p_product_id AND p.company_id = p_company_id;
  RETURN v_result;
END;
$$;

-- ── set flag (mutação aprovada) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_set_product_vender_com_estoque_zero(
  p_product_id uuid,
  p_company_id uuid,
  p_value boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET vender_com_estoque_zero = COALESCE(p_value, true)
  WHERE id = p_product_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_set_product_vender_com_estoque_zero(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_product_vender_com_estoque_zero(uuid, uuid, boolean) TO service_role;

-- ── rpc_get_public_menu: volumes + ocultar estoque 0 quando flag=false ─────
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
            COALESCE(
              pv.estoque_atual,
              (
                SELECT pv2.estoque_atual
                FROM public.product_volumes pv2
                WHERE pv2.product_id = p.id
                ORDER BY pv2.volume_quantidade NULLS LAST
                LIMIT 1
              ),
              0
            ) > 0                                              AS in_stock,
            CASE WHEN cat.name IS NULL THEN 999 ELSE 0 END     AS category_sort
        FROM public.products p
        INNER JOIN public.produto_embalagens pe
            ON pe.produto_id = p.id
        LEFT JOIN public.siglas_comerciais sc
            ON sc.id = pe.id_sigla_comercial
        LEFT JOIN public.categories cat
            ON cat.id = p.category_id
        LEFT JOIN public.product_volumes pv
            ON pv.id = pe.product_volume_id
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
            COALESCE(p.vender_com_estoque_zero, true) = true
            OR COALESCE(
              pv.estoque_atual,
              (
                SELECT pv2.estoque_atual
                FROM public.product_volumes pv2
                WHERE pv2.product_id = p.id
                ORDER BY pv2.volume_quantidade NULLS LAST
                LIMIT 1
              ),
              0
            ) > 0
          )
    ) x;

    RETURN jsonb_build_object(
        'store', jsonb_build_object(
            'company_id',     v_prof.company_id,
            'slug',           v_prof.slug,
            'display_name',   v_prof.display_name,
            'tagline',        v_prof.tagline,
            'logo_url',       v_prof.logo_url,
            'cover_url',      v_prof.cover_url,
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
