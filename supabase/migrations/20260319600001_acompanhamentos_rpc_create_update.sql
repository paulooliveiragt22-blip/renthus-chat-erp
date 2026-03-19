-- ============================================================
-- Acompanhamentos nas RPCs rpc_create_product_with_items e
-- rpc_update_product_with_items
-- ============================================================

-- 1. RPC create: adicionar p_acompanhamento_ids e inserir em produto_embalagem_acompanhamentos
CREATE OR REPLACE FUNCTION public.rpc_create_product_with_items(
  p_company_id uuid,
  p_name text,
  p_category_id uuid,
  p_is_active boolean DEFAULT true,
  p_volumes jsonb DEFAULT '[]'::jsonb,
  p_acompanhamento_ids uuid[] DEFAULT '{}'::uuid[]
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
  v_emb_id uuid;
  v_is_acomp boolean;
  v_idx int;
  v_acomp_id uuid;
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
      v_is_acomp := COALESCE((v_item->>'is_acompanhamento')::boolean, false);

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
        v_is_acomp,
        v_unit_type_id, v_vol_qty
      )
      RETURNING id INTO v_emb_id;

      IF v_is_acomp AND p_acompanhamento_ids IS NOT NULL AND array_length(p_acompanhamento_ids, 1) > 0 THEN
        FOR v_idx IN 1..least(array_length(p_acompanhamento_ids, 1), 2) LOOP
          v_acomp_id := p_acompanhamento_ids[v_idx];
          IF v_acomp_id IS NOT NULL AND v_acomp_id <> v_emb_id THEN
            INSERT INTO produto_embalagem_acompanhamentos (produto_embalagem_id, acompanhamento_produto_embalagem_id, ordem)
            VALUES (v_emb_id, v_acomp_id, v_idx)
            ON CONFLICT (produto_embalagem_id, acompanhamento_produto_embalagem_id) DO NOTHING;
          END IF;
        END LOOP;
      END IF;

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

-- 2. RPC update: adicionar p_acompanhamento_ids e inserir em produto_embalagem_acompanhamentos
CREATE OR REPLACE FUNCTION public.rpc_update_product_with_items(
  p_company_id uuid,
  p_product_id uuid,
  p_category_id uuid,
  p_is_active boolean,
  p_volumes jsonb,
  p_acompanhamento_ids uuid[] DEFAULT '{}'::uuid[]
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
  v_is_acomp boolean;
  v_idx int;
  v_acomp_id uuid;
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

      v_is_acomp := COALESCE((v_item->>'is_acompanhamento')::boolean, false);

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
        v_is_acomp,
        v_unit_type_id, v_vol_qty
      )
      RETURNING id INTO v_emb_id;

      IF v_is_acomp AND p_acompanhamento_ids IS NOT NULL AND array_length(p_acompanhamento_ids, 1) > 0 THEN
        FOR v_idx IN 1..least(array_length(p_acompanhamento_ids, 1), 2) LOOP
          v_acomp_id := p_acompanhamento_ids[v_idx];
          IF v_acomp_id IS NOT NULL AND v_acomp_id <> v_emb_id THEN
            INSERT INTO produto_embalagem_acompanhamentos (produto_embalagem_id, acompanhamento_produto_embalagem_id, ordem)
            VALUES (v_emb_id, v_acomp_id, v_idx)
            ON CONFLICT (produto_embalagem_id, acompanhamento_produto_embalagem_id) DO NOTHING;
          END IF;
        END LOOP;
      END IF;

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
