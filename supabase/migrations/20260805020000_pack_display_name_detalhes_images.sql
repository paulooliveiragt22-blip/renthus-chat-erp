-- ============================================================
-- 1) pe.descricao = nome do item; pe.detalhes = descrição longa
-- 2) display_name na view_chat_produtos
-- 3) primary image por escopo (produto vs volume)
-- 4) cardápio web: nome composto + detalhes + imagem volume→produto
-- ============================================================

ALTER TABLE public.produto_embalagens
  ADD COLUMN IF NOT EXISTS detalhes text NULL;

COMMENT ON COLUMN public.produto_embalagens.descricao IS
  'Nome do item/embalagem (ex.: CX 15UN, LONG NECK). Usado no display_name com products.name.';
COMMENT ON COLUMN public.produto_embalagens.detalhes IS
  'Descrição longa do item/embalagem para cardápio/chat (opcional).';

-- Primary image: um primary por (product_id, product_volume_id), não global no produto
CREATE OR REPLACE FUNCTION public.enforce_single_primary_image()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE public.product_images
    SET is_primary = false
    WHERE product_id = NEW.product_id
      AND id <> NEW.id
      AND is_primary = true
      AND product_volume_id IS NOT DISTINCT FROM NEW.product_volume_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ── view_chat_produtos (DROP para permitir novas colunas/ordem) ─────────────
DROP VIEW IF EXISTS public.view_chat_produtos;

CREATE VIEW public.view_chat_produtos AS
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
    NULLIF(trim(COALESCE(pe.descricao, '')), ''),
    CASE WHEN pe.volume_quantidade > 0 THEN pe.volume_quantidade::text ELSE NULL END,
    ut.sigla,
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
  ) AS estoque_unidades,
  pe.detalhes,
  -- Nome composto: produto + nome do item (descricao); fallback volume/sigla
  CASE
    WHEN NULLIF(trim(COALESCE(pe.descricao, '')), '') IS NOT NULL THEN
      CASE
        WHEN upper(trim(pe.descricao)) = upper(trim(p.name))
          OR upper(trim(pe.descricao)) LIKE upper(trim(p.name)) || ' %'
        THEN trim(pe.descricao)
        ELSE trim(p.name) || ' ' || trim(pe.descricao)
      END
    ELSE
      trim(concat_ws(' ',
        NULLIF(trim(p.name), ''),
        CASE
          WHEN pe.volume_quantidade > 0 AND ut.sigla IS NOT NULL
            THEN pe.volume_quantidade::text || ut.sigla
          ELSE NULL
        END,
        CASE
          WHEN upper(COALESCE(sc.sigla, 'UN')) NOT IN ('UN', 'UND', 'UNID', 'UNIDADE')
            THEN '(' || sc.sigla
                 || CASE WHEN pe.fator_conversao > 1 THEN ' c/' || pe.fator_conversao::text ELSE '' END
                 || ')'
          ELSE NULL
        END
      ))
  END AS display_name
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
  'Chatbot: display_name=produto+item; descricao=nome item; detalhes=descrição longa; imagem volume→produto.';

GRANT SELECT ON public.view_chat_produtos TO authenticated;
GRANT SELECT ON public.view_chat_produtos TO service_role;

-- ── rpc_get_public_menu ──────────────────────────────────────────────────────
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
              WHEN NULLIF(trim(COALESCE(pe.descricao, '')), '') IS NOT NULL THEN
                CASE
                  WHEN upper(trim(pe.descricao)) = upper(trim(p.name))
                    OR upper(trim(pe.descricao)) LIKE upper(trim(p.name)) || ' %'
                  THEN trim(pe.descricao)
                  ELSE trim(p.name) || ' ' || trim(pe.descricao)
                END
              ELSE
                CASE
                  WHEN upper(COALESCE(sc.sigla, 'UN')) IN ('UN', 'UND', 'UNID')
                    THEN COALESCE(NULLIF(trim(p.name), ''), 'Produto')
                         || CASE
                              WHEN pe.volume_quantidade > 0 AND ut.sigla IS NOT NULL
                                THEN ' ' || pe.volume_quantidade::text || ut.sigla
                              ELSE ''
                            END
                  ELSE COALESCE(NULLIF(trim(p.name), ''), 'Produto')
                       || CASE
                            WHEN pe.volume_quantidade > 0 AND ut.sigla IS NOT NULL
                              THEN ' ' || pe.volume_quantidade::text || ut.sigla
                            ELSE ''
                          END
                       || ' (' || COALESCE(sc.sigla, 'CX')
                       || CASE WHEN pe.fator_conversao > 1 THEN ' c/' || pe.fator_conversao::text ELSE '' END
                       || ')'
                END
            END                                                AS name,
            NULLIF(trim(COALESCE(pe.detalhes, '')), '')               AS description,
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
        LEFT JOIN public.unit_types ut
            ON ut.id = pe.id_unit_type
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

-- ── detalhes: apply after create/update + get_product_full ───────────────────
CREATE OR REPLACE FUNCTION public.rpc_apply_produto_embalagens_detalhes(
  p_company_id uuid,
  p_product_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_sigla uuid;
  v_detalhes text;
  v_fator numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_sigla := (v_item->>'id_sigla_comercial')::uuid;
    v_detalhes := nullif(trim(v_item->>'detalhes'), '');
    v_fator := GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1));
    IF v_sigla IS NULL THEN CONTINUE; END IF;

    UPDATE produto_embalagens pe
    SET detalhes = v_detalhes
    WHERE pe.produto_id = p_product_id
      AND pe.company_id = p_company_id
      AND pe.id_sigla_comercial = v_sigla
      AND pe.fator_conversao = v_fator;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_apply_produto_embalagens_detalhes(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_apply_produto_embalagens_detalhes(uuid, uuid, jsonb) TO service_role;
