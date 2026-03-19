-- ============================================================
-- preco_custo e tags por item (produto_embalagens)
-- Remover preco_custo de product_volumes; custo vem de cada item
-- Regra: CX 15 custou 150 → UN custo = 150/15 = 10
-- ============================================================

-- 1. Adicionar preco_custo em produto_embalagens
ALTER TABLE public.produto_embalagens
  ADD COLUMN IF NOT EXISTS preco_custo numeric;

COMMENT ON COLUMN public.produto_embalagens.preco_custo IS 'Custo por unidade desta embalagem. CX 15un custou 150 → preco_custo=150. UN custo = 150/15 = 10.';

-- 2. Migrar preco_custo de product_volumes para produto_embalagens (UN)
UPDATE public.produto_embalagens pe
SET preco_custo = pv.preco_custo
FROM public.product_volumes pv,
     public.siglas_comerciais sc
WHERE pe.product_volume_id = pv.id
  AND pe.id_sigla_comercial = sc.id
  AND upper(sc.sigla) IN ('UN', 'UNIDADE')
  AND pv.preco_custo IS NOT NULL
  AND pe.preco_custo IS NULL;

-- 3. Para CX: custo = (custo UN do volume) * fator_conversao
UPDATE public.produto_embalagens pe
SET preco_custo = sub.custo_cx
FROM (
  SELECT pe2.id AS pe_id,
         un_pe.preco_custo * pe2.fator_conversao AS custo_cx
  FROM public.produto_embalagens pe2
  JOIN public.produto_embalagens un_pe ON un_pe.product_volume_id = pe2.product_volume_id
  JOIN public.siglas_comerciais sc_un ON sc_un.id = un_pe.id_sigla_comercial AND upper(sc_un.sigla) IN ('UN', 'UNIDADE')
  JOIN public.siglas_comerciais sc2 ON sc2.id = pe2.id_sigla_comercial AND upper(sc2.sigla) NOT IN ('UN', 'UNIDADE')
  WHERE un_pe.preco_custo IS NOT NULL
    AND (pe2.preco_custo IS NULL OR pe2.preco_custo = 0)
) sub
WHERE pe.id = sub.pe_id;

-- 4. Remover preco_custo de product_volumes (opcional - manter coluna mas não usar)
-- ALTER TABLE product_volumes DROP COLUMN IF EXISTS preco_custo;
-- Mantemos a coluna para não quebrar migrações; views passarão a usar produto_embalagens.preco_custo

-- 5. Atualizar view_products_estoque para usar custo do primeiro item UN do volume
DROP VIEW IF EXISTS public.view_products_estoque;
CREATE VIEW public.view_products_estoque AS
SELECT
  pv.id,
  pv.company_id,
  p.name,
  (pe.codigo_interno)::text AS codigo_interno,
  CASE
    WHEN pv.volume_quantidade IS NOT NULL AND ut.sigla IS NOT NULL
    THEN (pv.volume_quantidade::text || ' ' || ut.sigla)
    ELSE p.name
  END AS details,
  COALESCE(pe.preco_custo, pv.preco_custo, p.preco_custo_unitario) AS preco_custo_unitario,
  pv.estoque_atual,
  pv.estoque_minimo,
  p.is_active,
  p.category_id,
  p.created_at,
  c.name AS category_name,
  pv.product_id
FROM public.product_volumes pv
JOIN public.products p ON p.id = pv.product_id
LEFT JOIN public.categories c ON c.id = p.category_id
LEFT JOIN public.unit_types ut ON ut.id = pv.id_unit_type
LEFT JOIN LATERAL (
  SELECT pe.codigo_interno, pe.preco_custo
  FROM public.produto_embalagens pe
  JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  WHERE pe.product_volume_id = pv.id AND upper(sc.sigla) IN ('UN', 'UNIDADE')
  LIMIT 1
) pe ON true;

-- 6. RPC: buscar produto completo (volumes + itens) para edição
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

-- 7. RPC: criar produto com múltiplos volumes e itens
CREATE OR REPLACE FUNCTION public.rpc_create_product_with_items(
  p_company_id uuid,
  p_name text,
  p_category_id uuid,
  p_is_active boolean DEFAULT true,
  p_volumes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_vol jsonb;
  v_item jsonb;
  v_volume_id uuid;
  v_vol_qty numeric;
  v_unit_type_id uuid;
  v_estoque numeric;
  v_estoque_min numeric;
  v_preco_custo numeric;
BEGIN
  IF nullif(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do produto é obrigatório';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE company_id = p_company_id AND lower(trim(name)) = lower(trim(p_name))) THEN
    RAISE EXCEPTION 'Produto com nome "%" já existe nesta empresa', trim(p_name);
  END IF;

  INSERT INTO products (company_id, name, category_id, preco_custo_unitario, estoque_atual, estoque_minimo, is_active)
  VALUES (p_company_id, nullif(trim(p_name), ''), p_category_id, 0, 0, 0, COALESCE(p_is_active, true))
  RETURNING id INTO v_product_id;

  FOR v_vol IN SELECT * FROM jsonb_array_elements(p_volumes)
  LOOP
    v_vol_qty := (v_vol->>'volume_quantidade')::numeric;
    v_unit_type_id := (v_vol->>'id_unit_type')::uuid;
    v_estoque := 0; v_estoque_min := 0;

    INSERT INTO product_volumes (company_id, product_id, volume_quantidade, id_unit_type, estoque_atual, estoque_minimo)
    VALUES (p_company_id, v_product_id, v_vol_qty, v_unit_type_id, 0, 0)
    RETURNING id INTO v_volume_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_vol->'items')
    LOOP
      IF (v_item->>'id_sigla_comercial')::uuid IS NULL THEN CONTINUE; END IF;

      v_preco_custo := (v_item->>'preco_custo')::numeric;

      INSERT INTO produto_embalagens (
        company_id, produto_id, product_volume_id, id_sigla_comercial,
        descricao, fator_conversao, preco_venda, preco_custo, codigo_interno, codigo_barras_ean,
        tags, is_acompanhamento, id_unit_type, volume_quantidade
      ) VALUES (
        p_company_id, v_product_id, v_volume_id, (v_item->>'id_sigla_comercial')::uuid,
        nullif(trim(v_item->>'descricao'), ''),
        GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)),
        COALESCE((v_item->>'preco_venda')::numeric, 0),
        v_preco_custo,
        nullif(trim(v_item->>'codigo_interno'), ''),
        nullif(trim(v_item->>'codigo_barras_ean'), ''),
        nullif(trim(v_item->>'tags'), ''),
        COALESCE((v_item->>'is_acompanhamento')::boolean, false),
        v_unit_type_id, v_vol_qty
      );

      IF (v_item->>'estoque') IS NOT NULL AND (v_item->>'estoque')::numeric > 0 THEN
        v_estoque := GREATEST(v_estoque, (v_item->>'estoque')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)));
      END IF;
      IF (v_item->>'estoque_minimo') IS NOT NULL AND (v_item->>'estoque_minimo')::numeric >= 0 THEN
        v_estoque_min := GREATEST(v_estoque_min, (v_item->>'estoque_minimo')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)));
      END IF;
    END LOOP;

    IF v_estoque > 0 OR v_estoque_min > 0 THEN
      UPDATE product_volumes SET estoque_atual = v_estoque, estoque_minimo = v_estoque_min, updated_at = now() WHERE id = v_volume_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('product_id', v_product_id);
END;
$$;

-- 8. RPC: atualizar produto com múltiplos volumes e itens
CREATE OR REPLACE FUNCTION public.rpc_update_product_with_items(
  p_company_id uuid,
  p_product_id uuid,
  p_category_id uuid,
  p_is_active boolean,
  p_volumes jsonb
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
  v_vol_qty numeric;
  v_unit_type_id uuid;
  v_estoque numeric;
  v_estoque_min numeric;
  v_emb_id uuid;
BEGIN
  UPDATE products SET category_id = p_category_id, is_active = p_is_active
  WHERE id = p_product_id AND company_id = p_company_id;

  DELETE FROM produto_embalagens WHERE produto_id = p_product_id AND company_id = p_company_id;
  DELETE FROM product_volumes WHERE product_id = p_product_id AND company_id = p_company_id;

  FOR v_vol IN SELECT * FROM jsonb_array_elements(p_volumes)
  LOOP
    v_vol_qty := (v_vol->>'volume_quantidade')::numeric;
    v_unit_type_id := (v_vol->>'id_unit_type')::uuid;
    v_estoque := 0; v_estoque_min := 0;

    INSERT INTO product_volumes (company_id, product_id, volume_quantidade, id_unit_type, estoque_atual, estoque_minimo)
    VALUES (p_company_id, p_product_id, v_vol_qty, v_unit_type_id, 0, 0)
    RETURNING id INTO v_volume_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_vol->'items')
    LOOP
      IF (v_item->>'id_sigla_comercial')::uuid IS NULL THEN CONTINUE; END IF;

      INSERT INTO produto_embalagens (
        company_id, produto_id, product_volume_id, id_sigla_comercial,
        descricao, fator_conversao, preco_venda, preco_custo, codigo_interno, codigo_barras_ean,
        tags, is_acompanhamento, id_unit_type, volume_quantidade
      ) VALUES (
        p_company_id, p_product_id, v_volume_id, (v_item->>'id_sigla_comercial')::uuid,
        nullif(trim(v_item->>'descricao'), ''),
        GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)),
        COALESCE((v_item->>'preco_venda')::numeric, 0),
        (v_item->>'preco_custo')::numeric,
        nullif(trim(v_item->>'codigo_interno'), ''),
        nullif(trim(v_item->>'codigo_barras_ean'), ''),
        nullif(trim(v_item->>'tags'), ''),
        COALESCE((v_item->>'is_acompanhamento')::boolean, false),
        v_unit_type_id, v_vol_qty
      );

      IF (v_item->>'estoque') IS NOT NULL AND (v_item->>'estoque')::numeric > 0 THEN
        v_estoque := GREATEST(v_estoque, (v_item->>'estoque')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)));
      END IF;
      IF (v_item->>'estoque_minimo') IS NOT NULL AND (v_item->>'estoque_minimo')::numeric >= 0 THEN
        v_estoque_min := GREATEST(v_estoque_min, (v_item->>'estoque_minimo')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)));
      END IF;
    END LOOP;

    IF v_estoque > 0 OR v_estoque_min > 0 THEN
      UPDATE product_volumes SET estoque_atual = v_estoque, estoque_minimo = v_estoque_min, updated_at = now() WHERE id = v_volume_id;
    END IF;
  END LOOP;
END;
$$;
