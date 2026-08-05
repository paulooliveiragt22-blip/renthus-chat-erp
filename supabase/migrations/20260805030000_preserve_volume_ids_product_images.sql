-- ============================================================
-- Preserva IDs de product_volumes / produto_embalagens no update
-- e evita que fotos de volume virem foto de produto (SET NULL).
--
-- Bug: rpc_update_product_with_items fazia DELETE+INSERT de volumes;
-- product_images.product_volume_id ON DELETE SET NULL promovia a
-- imagem do tamanho a primary do produto → aparecia em todos os itens.
-- ============================================================

-- 1) FK: apagar volume remove só as fotos daquele volume (não promove a produto)
ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_product_volume_id_fkey;

ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_product_volume_id_fkey
  FOREIGN KEY (product_volume_id)
  REFERENCES public.product_volumes(id)
  ON DELETE CASCADE;

-- 2) RPC: upsert por id (preserva FKs de imagens e order_items)
DROP FUNCTION IF EXISTS public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb);
DROP FUNCTION IF EXISTS public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb, uuid[]);

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
  v_payload_vol_id uuid;
  v_vol_qty numeric;
  v_unit_type_id uuid;
  v_estoque numeric;
  v_estoque_min numeric;
  v_emb_id uuid;
  v_payload_emb_id uuid;
  v_is_acomp boolean;
  v_idx int;
  v_acomp_id uuid;
  v_keep_volume_ids uuid[] := ARRAY[]::uuid[];
  v_keep_emb_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  UPDATE products
  SET category_id = p_category_id,
      is_active = p_is_active
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

    -- Fallback: mesmo tamanho (qty+unidade) já existente no produto
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
          id_unit_type, volume_quantidade
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
          v_vol_qty
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
            volume_quantidade = v_vol_qty
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

  -- Remove embalagens/volumes que saíram do formulário
  DELETE FROM produto_embalagens pe
  WHERE pe.produto_id = p_product_id
    AND pe.company_id = p_company_id
    AND (
      cardinality(v_keep_emb_ids) = 0
      OR pe.id <> ALL (v_keep_emb_ids)
    );

  DELETE FROM product_volumes pv
  WHERE pv.product_id = p_product_id
    AND pv.company_id = p_company_id
    AND (
      cardinality(v_keep_volume_ids) = 0
      OR pv.id <> ALL (v_keep_volume_ids)
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_update_product_with_items(uuid, uuid, uuid, boolean, jsonb, uuid[]) IS
  'Atualiza produto + volumes/itens por upsert de id (preserva product_images.product_volume_id e FKs de pedidos).';
