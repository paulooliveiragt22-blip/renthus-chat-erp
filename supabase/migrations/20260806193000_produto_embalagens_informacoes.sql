-- Ingredientes vs informações do prato (por embalagem/item).
-- detalhes = ingredientes / "o que acompanha" (já existia; comentário alinhado).
-- informacoes = como é feito / info extra para o chat.

ALTER TABLE public.produto_embalagens
  ADD COLUMN IF NOT EXISTS informacoes text NULL;

COMMENT ON COLUMN public.produto_embalagens.descricao IS
  'Nome curto do item/embalagem (ex.: LATA, CX 15UN).';
COMMENT ON COLUMN public.produto_embalagens.detalhes IS
  'Ingredientes / o que acompanha (ex.: carne, tomate, alface). Bot responde em "o que tem nesse…".';
COMMENT ON COLUMN public.produto_embalagens.informacoes IS
  'Informações do prato/produto: modo de preparo, detalhes extras (não confundir com ingredientes).';

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
  COALESCE(pie.thumbnail_url, piv.thumbnail_url, pip.thumbnail_url) AS thumbnail_url,
  COALESCE(pie.url,           piv.url,           pip.url)           AS image_url,
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
  pe.informacoes,
  (
    WITH base AS (
      SELECT CASE
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
            END
          ))
      END AS name_base
    )
    SELECT CASE
      WHEN upper(COALESCE(sc.sigla, 'UN')) NOT IN ('UN', 'UND', 'UNID', 'UNIDADE')
           AND pe.fator_conversao > 1
           AND base.name_base !~* 'c/[0-9]+'
        THEN trim(base.name_base) || ' (' || sc.sigla || ' c/' || pe.fator_conversao::text || ')'
      WHEN upper(COALESCE(sc.sigla, 'UN')) NOT IN ('UN', 'UND', 'UNID', 'UNIDADE')
           AND (pe.fator_conversao IS NULL OR pe.fator_conversao <= 1)
           AND base.name_base !~* ('\(' || COALESCE(sc.sigla, 'CX'))
        THEN trim(base.name_base) || ' (' || sc.sigla || ')'
      ELSE trim(base.name_base)
    END
    FROM base
  ) AS display_name,
  COALESCE(pe.is_active, true) AS item_is_active
FROM public.produto_embalagens pe
JOIN public.products          p  ON p.id  = pe.produto_id
JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
LEFT JOIN public.unit_types   ut ON ut.id  = pe.id_unit_type
LEFT JOIN public.product_volumes pv ON pv.id = pe.product_volume_id
LEFT JOIN public.product_images pie
       ON pie.produto_embalagem_id = pe.id
      AND pie.is_primary = true
LEFT JOIN public.product_images piv
       ON piv.product_volume_id = pe.product_volume_id
      AND piv.is_primary = true
      AND piv.produto_embalagem_id IS NULL
      AND pe.product_volume_id IS NOT NULL
LEFT JOIN public.product_images pip
       ON pip.product_id       = p.id
      AND pip.product_volume_id IS NULL
      AND pip.produto_embalagem_id IS NULL
      AND pip.is_primary = true
WHERE p.is_active = true
  AND COALESCE(pe.is_active, true) = true;

COMMENT ON VIEW public.view_chat_produtos IS
  'Catálogo chatbot: embalagens ativas. detalhes=ingredientes; informacoes=preparo/extras. Estoque/custo não devem ir ao LLM público.';

GRANT SELECT ON public.view_chat_produtos TO authenticated;
GRANT SELECT ON public.view_chat_produtos TO service_role;

-- Admin UI: devolver informacoes no get completo
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
                'descricao', pe.descricao, 'detalhes', pe.detalhes, 'informacoes', pe.informacoes,
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

REVOKE ALL ON FUNCTION public.rpc_get_product_full(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_product_full(uuid, uuid) TO service_role;

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
  v_informacoes text;
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
    v_informacoes := nullif(trim(v_item->>'informacoes'), '');
    v_fator := GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1));
    IF v_sigla IS NULL THEN CONTINUE; END IF;

    UPDATE produto_embalagens pe
    SET
      detalhes = v_detalhes,
      informacoes = v_informacoes
    WHERE pe.produto_id = p_product_id
      AND pe.company_id = p_company_id
      AND pe.id_sigla_comercial = v_sigla
      AND pe.fator_conversao = v_fator;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_apply_produto_embalagens_detalhes(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_apply_produto_embalagens_detalhes(uuid, uuid, jsonb) TO service_role;
