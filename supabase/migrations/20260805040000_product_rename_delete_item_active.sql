-- ============================================================
-- 1) Editar nome do produto no update
-- 2) Excluir produto só se nunca vendido; senão desativa
-- 3) is_active por embalagem (item) + soft-delete se já vendida
-- ============================================================

ALTER TABLE public.produto_embalagens
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.produto_embalagens.is_active IS
  'false = item oculto no PDV/chat/cardápio; produto pai pode continuar ativo.';

CREATE INDEX IF NOT EXISTS idx_produto_embalagens_active
  ON public.produto_embalagens (company_id, is_active)
  WHERE is_active = true;

-- ── helper: embalagem já comercializada? ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_embalagem_foi_vendida(p_emb_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.order_items oi WHERE oi.produto_embalagem_id = p_emb_id
  ) OR EXISTS (
    SELECT 1 FROM public.sale_items si WHERE si.produto_embalagem_id = p_emb_id
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_produto_foi_vendido(p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.product_id = p_product_id
       OR oi.produto_embalagem_id IN (
         SELECT pe.id FROM public.produto_embalagens pe WHERE pe.produto_id = p_product_id
       )
  ) OR EXISTS (
    SELECT 1 FROM public.sale_items si
    WHERE si.produto_embalagem_id IN (
      SELECT pe.id FROM public.produto_embalagens pe WHERE pe.produto_id = p_product_id
    )
  );
$$;

-- ── delete ou desativar produto ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_delete_or_deactivate_product(
  p_product_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = p_product_id AND company_id = p_company_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF public.fn_produto_foi_vendido(p_product_id) THEN
    UPDATE public.products
    SET is_active = false
    WHERE id = p_product_id AND company_id = p_company_id;

    -- Oculta itens também (consistência no catálogo)
    UPDATE public.produto_embalagens
    SET is_active = false
    WHERE produto_id = p_product_id AND company_id = p_company_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'deactivated',
      'product_id', p_product_id,
      'message', 'Produto já comercializado: desativado (não excluído).'
    );
  END IF;

  DELETE FROM public.products
  WHERE id = p_product_id AND company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'product_id', p_product_id,
    'message', 'Produto excluído.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_delete_or_deactivate_product(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_delete_or_deactivate_product(uuid, uuid) TO service_role;

-- ── toggle item ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_toggle_produto_embalagem_active(
  p_embalagem_id uuid,
  p_company_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.produto_embalagens
  SET is_active = COALESCE(p_is_active, true)
  WHERE id = p_embalagem_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'embalagem_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_toggle_produto_embalagem_active(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_toggle_produto_embalagem_active(uuid, uuid, boolean) TO service_role;

-- ── update com nome + is_active item + soft-delete se vendida ───────────────
DROP FUNCTION IF EXISTS public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb);
DROP FUNCTION IF EXISTS public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb, uuid[]);
DROP FUNCTION IF EXISTS public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb, uuid[], text);

CREATE OR REPLACE FUNCTION public.rpc_update_product_with_items(
  p_company_id uuid,
  p_product_id uuid,
  p_category_id uuid,
  p_is_active boolean,
  p_volumes jsonb,
  p_acompanhamento_ids uuid[] DEFAULT '{}'::uuid[],
  p_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vol jsonb;
  v_item jsonb;
  v_volume_id uuid;
  v_payload_vol_id uuid;
  v_vol_qty numeric;
  v_unit_type_id uuid;
  v_estoque numeric;
  v_estoque_min numeric;
  v_emb_id uuid;
  v_payload_emb_id uuid;
  v_is_acomp boolean;
  v_item_active boolean;
  v_idx int;
  v_acomp_id uuid;
  v_keep_volume_ids uuid[] := ARRAY[]::uuid[];
  v_keep_emb_ids uuid[] := ARRAY[]::uuid[];
  v_name text;
  v_orphan_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  v_name := nullif(trim(COALESCE(p_name, '')), '');
  IF v_name IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM products
      WHERE company_id = p_company_id
        AND id <> p_product_id
        AND lower(trim(name)) = lower(v_name)
    ) THEN
      RAISE EXCEPTION 'Produto com nome "%" já existe nesta empresa', v_name;
    END IF;
  END IF;

  UPDATE products
  SET category_id = p_category_id,
      is_active = p_is_active,
      name = COALESCE(v_name, name)
  WHERE id = p_product_id AND company_id = p_company_id;

  FOR v_vol IN SELECT * FROM jsonb_array_elements(COALESCE(p_volumes, '[]'::jsonb))
  LOOP
    v_vol_qty := NULLIF(v_vol->>'volume_quantidade', '')::numeric;
    v_unit_type_id := NULLIF(v_vol->>'id_unit_type', '')::uuid;
    v_estoque := 0;
    v_estoque_min := 0;
    v_payload_vol_id := COALESCE(
      NULLIF(v_vol->>'id', '')::uuid,
      NULLIF(v_vol->>'volume_id', '')::uuid
    );

    v_volume_id := NULL;
    IF v_payload_vol_id IS NOT NULL THEN
      SELECT pv.id INTO v_volume_id
      FROM product_volumes pv
      WHERE pv.id = v_payload_vol_id
        AND pv.product_id = p_product_id
        AND pv.company_id = p_company_id;
    END IF;

    IF v_volume_id IS NULL THEN
      SELECT pv.id INTO v_volume_id
      FROM product_volumes pv
      WHERE pv.product_id = p_product_id
        AND pv.company_id = p_company_id
        AND pv.volume_quantidade IS NOT DISTINCT FROM v_vol_qty
        AND pv.id_unit_type IS NOT DISTINCT FROM v_unit_type_id
      LIMIT 1;
    END IF;

    IF v_volume_id IS NULL THEN
      INSERT INTO product_volumes (
        company_id, product_id, volume_quantidade, id_unit_type,
        estoque_atual, estoque_minimo
      )
      VALUES (p_company_id, p_product_id, v_vol_qty, v_unit_type_id, 0, 0)
      RETURNING id INTO v_volume_id;
    ELSE
      UPDATE product_volumes
      SET volume_quantidade = v_vol_qty,
          id_unit_type = v_unit_type_id,
          updated_at = now()
      WHERE id = v_volume_id;
    END IF;

    v_keep_volume_ids := array_append(v_keep_volume_ids, v_volume_id);

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_vol->'items', '[]'::jsonb))
    LOOP
      IF NULLIF(v_item->>'id_sigla_comercial', '') IS NULL THEN
        CONTINUE;
      END IF;

      v_is_acomp := COALESCE((v_item->>'is_acompanhamento')::boolean, false);
      v_item_active := COALESCE((v_item->>'is_active')::boolean, true);
      v_payload_emb_id := NULLIF(v_item->>'id', '')::uuid;
      v_emb_id := NULL;

      IF v_payload_emb_id IS NOT NULL THEN
        SELECT pe.id INTO v_emb_id
        FROM produto_embalagens pe
        WHERE pe.id = v_payload_emb_id
          AND pe.produto_id = p_product_id
          AND pe.company_id = p_company_id;
      END IF;

      IF v_emb_id IS NULL THEN
        INSERT INTO produto_embalagens (
          company_id, produto_id, product_volume_id, id_sigla_comercial,
          descricao, detalhes, fator_conversao, preco_venda, preco_custo,
          codigo_interno, codigo_barras_ean, tags, is_acompanhamento,
          id_unit_type, volume_quantidade, is_active
        ) VALUES (
          p_company_id, p_product_id, v_volume_id,
          (v_item->>'id_sigla_comercial')::uuid,
          nullif(trim(v_item->>'descricao'), ''),
          nullif(trim(v_item->>'detalhes'), ''),
          GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)),
          COALESCE((v_item->>'preco_venda')::numeric, 0),
          (v_item->>'preco_custo')::numeric,
          nullif(trim(v_item->>'codigo_interno'), ''),
          nullif(trim(v_item->>'codigo_barras_ean'), ''),
          nullif(trim(v_item->>'tags'), ''),
          v_is_acomp,
          v_unit_type_id,
          v_vol_qty,
          v_item_active
        )
        RETURNING id INTO v_emb_id;
      ELSE
        UPDATE produto_embalagens
        SET product_volume_id = v_volume_id,
            id_sigla_comercial = (v_item->>'id_sigla_comercial')::uuid,
            descricao = nullif(trim(v_item->>'descricao'), ''),
            detalhes = nullif(trim(v_item->>'detalhes'), ''),
            fator_conversao = GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)),
            preco_venda = COALESCE((v_item->>'preco_venda')::numeric, 0),
            preco_custo = (v_item->>'preco_custo')::numeric,
            codigo_interno = nullif(trim(v_item->>'codigo_interno'), ''),
            codigo_barras_ean = nullif(trim(v_item->>'codigo_barras_ean'), ''),
            tags = nullif(trim(v_item->>'tags'), ''),
            is_acompanhamento = v_is_acomp,
            id_unit_type = v_unit_type_id,
            volume_quantidade = v_vol_qty,
            is_active = v_item_active
        WHERE id = v_emb_id;
      END IF;

      v_keep_emb_ids := array_append(v_keep_emb_ids, v_emb_id);

      DELETE FROM produto_embalagem_acompanhamentos
      WHERE produto_embalagem_id = v_emb_id;

      IF v_is_acomp AND p_acompanhamento_ids IS NOT NULL AND array_length(p_acompanhamento_ids, 1) > 0 THEN
        FOR v_idx IN 1..least(array_length(p_acompanhamento_ids, 1), 2) LOOP
          v_acomp_id := p_acompanhamento_ids[v_idx];
          IF v_acomp_id IS NOT NULL AND v_acomp_id <> v_emb_id THEN
            INSERT INTO produto_embalagem_acompanhamentos (
              produto_embalagem_id, acompanhamento_produto_embalagem_id, ordem
            )
            VALUES (v_emb_id, v_acomp_id, v_idx)
            ON CONFLICT (produto_embalagem_id, acompanhamento_produto_embalagem_id) DO NOTHING;
          END IF;
        END LOOP;
      END IF;

      IF (v_item->>'estoque') IS NOT NULL AND (v_item->>'estoque')::numeric > 0 THEN
        v_estoque := GREATEST(
          v_estoque,
          (v_item->>'estoque')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1))
        );
      END IF;
      IF (v_item->>'estoque_minimo') IS NOT NULL AND (v_item->>'estoque_minimo')::numeric >= 0 THEN
        v_estoque_min := GREATEST(
          v_estoque_min,
          (v_item->>'estoque_minimo')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1))
        );
      END IF;
    END LOOP;

    UPDATE product_volumes
    SET estoque_atual = v_estoque,
        estoque_minimo = v_estoque_min,
        updated_at = now()
    WHERE id = v_volume_id;
  END LOOP;

  -- Itens fora do form: desativa se vendidos; senão exclui
  FOR v_orphan_id IN
    SELECT pe.id
    FROM produto_embalagens pe
    WHERE pe.produto_id = p_product_id
      AND pe.company_id = p_company_id
      AND (
        cardinality(v_keep_emb_ids) = 0
        OR pe.id <> ALL (v_keep_emb_ids)
      )
  LOOP
    IF public.fn_embalagem_foi_vendida(v_orphan_id) THEN
      UPDATE produto_embalagens SET is_active = false WHERE id = v_orphan_id;
    ELSE
      DELETE FROM produto_embalagens WHERE id = v_orphan_id;
    END IF;
  END LOOP;

  -- Volumes sem itens restantes
  DELETE FROM product_volumes pv
  WHERE pv.product_id = p_product_id
    AND pv.company_id = p_company_id
    AND NOT EXISTS (
      SELECT 1 FROM produto_embalagens pe WHERE pe.product_volume_id = pv.id
    )
    AND (
      cardinality(v_keep_volume_ids) = 0
      OR pv.id <> ALL (v_keep_volume_ids)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb, uuid[], text) TO service_role;

-- ── rpc_get_product_full: inclui is_active do item ───────────────────────────
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
                'descricao', pe.descricao, 'detalhes', pe.detalhes,
                'fator_conversao', pe.fator_conversao, 'preco_venda', pe.preco_venda,
                'preco_custo', pe.preco_custo, 'codigo_interno', pe.codigo_interno, 'codigo_barras_ean', pe.codigo_barras_ean,
                'tags', pe.tags, 'is_acompanhamento', pe.is_acompanhamento,
                'is_active', COALESCE(pe.is_active, true)
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

-- ── views: ocultar item inativo no chat/PDV ──────────────────────────────────
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
  END AS display_name,
  COALESCE(pe.is_active, true) AS item_is_active
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
WHERE p.is_active = true
  AND COALESCE(pe.is_active, true) = true;

GRANT SELECT ON public.view_chat_produtos TO authenticated;
GRANT SELECT ON public.view_chat_produtos TO service_role;

DROP VIEW IF EXISTS public.view_pdv_produtos;
CREATE VIEW public.view_pdv_produtos AS
SELECT pe.id,
    pe.company_id,
    pe.produto_id,
    pe.descricao,
    pe.fator_conversao,
    pe.preco_venda,
    pe.codigo_interno,
    pe.codigo_barras_ean,
    pe.tags,
    pe.product_volume_id,
    pv.volume_quantidade,
    pv.id_unit_type AS volume_id_unit_type,
    CASE
        WHEN pv.volume_quantidade IS NOT NULL AND ut.sigla IS NOT NULL
          THEN TRIM(BOTH FROM (pv.volume_quantidade::text || ' '::text) || ut.sigla::text)
        WHEN pv.volume_quantidade IS NOT NULL THEN pv.volume_quantidade::text
        ELSE NULL::text
    END AS volume_formatado,
    sc.sigla AS sigla_comercial,
    CASE upper(TRIM(BOTH FROM sc.sigla))
        WHEN 'CX'::text THEN 'Caixa'::text
        WHEN 'UN'::text THEN 'Unidade'::text
        WHEN 'UNIDADE'::text THEN 'Unidade'::text
        WHEN 'FARD'::text THEN 'Fardo'::text
        WHEN 'PAC'::text THEN 'Pacote'::text
        WHEN 'KG'::text THEN 'Quilograma'::text
        WHEN 'G'::text THEN 'Grama'::text
        WHEN 'L'::text THEN 'Litro'::text
        WHEN 'ML'::text THEN 'Mililitro'::text
        ELSE COALESCE(NULLIF(TRIM(BOTH FROM sc.descricao), ''::text), sc.sigla::text)
    END AS sigla_humanizada,
    COALESCE(sales.sales_count, 0::bigint) AS sales_count,
    p.name AS product_name,
    p.is_active,
    p.unit_type AS product_unit_type,
    p.details AS product_details,
    p.preco_custo_unitario AS product_preco_custo,
    c.name AS category_name,
    COALESCE(pe.is_active, true) AS item_is_active
FROM produto_embalagens pe
JOIN products p ON p.id = pe.produto_id
JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
LEFT JOIN product_volumes pv ON pv.id = pe.product_volume_id
LEFT JOIN unit_types ut ON ut.id = pv.id_unit_type
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(oi.quantity), 0::bigint) AS sales_count
  FROM order_items oi
  WHERE oi.produto_embalagem_id = pe.id
) sales ON true
WHERE p.is_active = true
  AND COALESCE(pe.is_active, true) = true;

GRANT SELECT ON public.view_pdv_produtos TO authenticated;
GRANT SELECT ON public.view_pdv_produtos TO service_role;

-- Lista admin: mostra ativos e inativos; expõe item_is_active
CREATE OR REPLACE VIEW public.view_produtos_lista AS
WITH un_packs AS (
  SELECT pe.id, pe.company_id, pe.produto_id, pe.descricao, pe.fator_conversao,
         pe.preco_venda, pe.preco_custo, pe.tags, pe.codigo_barras_ean,
         pe.is_acompanhamento, pe.codigo_interno, pe.id_sigla_comercial,
         pe.id_unit_type, pe.volume_quantidade, pe.product_volume_id,
         sc.sigla AS sigla_comercial, ut.sigla AS unit_type_sigla,
         COALESCE(pe.is_active, true) AS item_is_active
  FROM produto_embalagens pe
  JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  LEFT JOIN unit_types ut ON ut.id = pe.id_unit_type
  WHERE upper(sc.sigla::text) = ANY (ARRAY['UN'::text, 'UNIDADE'::text])
),
case_packs AS (
  SELECT DISTINCT ON (pe.produto_id)
    pe.id AS case_id, pe.produto_id, pe.descricao AS case_details,
    pe.fator_conversao AS case_qty, pe.preco_venda AS case_price,
    pe.id_sigla_comercial AS case_sigla_id, pe.codigo_interno AS case_codigo_interno,
    COALESCE(pe.is_active, true) AS case_is_active
  FROM produto_embalagens pe
  JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  WHERE upper(sc.sigla::text) = ANY (ARRAY['CX'::text, 'CAIXA'::text, 'FARD'::text, 'PAC'::text])
  ORDER BY pe.produto_id, (
    CASE upper(sc.sigla::text)
      WHEN 'CX'::text THEN 1 WHEN 'CAIXA'::text THEN 2 WHEN 'FARD'::text THEN 3 ELSE 4
    END
  ), pe.is_active DESC
)
SELECT
  un.company_id, un.id, un.produto_id AS product_id, un.descricao AS details,
  un.id_unit_type, un.volume_quantidade AS volume_value,
  CASE
    WHEN un.unit_type_sigla::text = 'L'::text THEN 'l'::text
    WHEN un.unit_type_sigla::text = ANY (ARRAY['ml'::character varying, 'kg'::character varying, 'm'::character varying]::text[])
      THEN lower(un.unit_type_sigla::text)
    ELSE 'none'::text
  END AS unit,
  un.preco_venda AS unit_price,
  COALESCE(un.preco_custo, p.preco_custo_unitario) AS cost_price,
  un.tags, un.codigo_barras_ean, un.is_acompanhamento, un.codigo_interno,
  CASE WHEN cp.case_id IS NOT NULL THEN true ELSE false END AS has_case,
  cp.case_id, cp.case_qty, cp.case_price, cp.case_details, cp.case_sigla_id, cp.case_codigo_interno,
  p.is_active, p.name AS product_name, p.category_id, c.name AS category_name,
  un.product_volume_id,
  COALESCE(pv.estoque_atual, 0::numeric) AS estoque_un,
  CASE
    WHEN cp.case_qty IS NOT NULL AND cp.case_qty > 0::numeric
      THEN floor(COALESCE(pv.estoque_atual, 0::numeric) / cp.case_qty)
    ELSE NULL::numeric
  END AS estoque_cx,
  COALESCE(p.vender_com_estoque_zero, true) AS vender_com_estoque_zero,
  un.item_is_active,
  COALESCE(cp.case_is_active, true) AS case_is_active
FROM un_packs un
JOIN products p ON p.id = un.produto_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN case_packs cp ON cp.produto_id = un.produto_id
LEFT JOIN product_volumes pv ON pv.id = un.product_volume_id;

GRANT SELECT ON public.view_produtos_lista TO authenticated;
GRANT SELECT ON public.view_produtos_lista TO service_role;

-- Cardápio web: recria com filtro pe.is_active (base 20260805020000)
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
            NULLIF(trim(COALESCE(pe.detalhes, '')), '')        AS description,
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
          AND COALESCE(pe.is_active, true) = true
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
