-- ============================================================
-- Fix 1: order_items / sale_items — FK ON DELETE SET NULL
--
-- Antes: REFERENCES produto_embalagens(id)  → padrão RESTRICT
-- Depois: ON DELETE SET NULL
--
-- Motivo: rpc_update_product_with_items faz DELETE+INSERT de
-- produto_embalagens para atualizar embalagens. Com RESTRICT, o
-- DELETE falha se algum pedido (order_items / sale_items) referenciar
-- a embalagem. Com SET NULL os order_items históricos mantêm os
-- dados textuais (product_name, unit_price etc.) e apenas a FK
-- se torna NULL — comportamento correto para audit trail.
-- ============================================================

-- order_items
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_produto_embalagem_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_produto_embalagem_id_fkey
  FOREIGN KEY (produto_embalagem_id)
  REFERENCES public.produto_embalagens(id)
  ON DELETE SET NULL;

-- sale_items (mesma necessidade)
ALTER TABLE public.sale_items
  DROP CONSTRAINT IF EXISTS sale_items_produto_embalagem_id_fkey;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_produto_embalagem_id_fkey
  FOREIGN KEY (produto_embalagem_id)
  REFERENCES public.produto_embalagens(id)
  ON DELETE SET NULL;

-- ============================================================
-- Fix 2: rpc_update_product_with_items — preserva estoque ao editar
--
-- Antes: DELETE + INSERT sempre começava com estoque_atual = 0
-- Depois: salva os estoques existentes por (volume_quantidade, id_unit_type)
--         antes do DELETE e restaura após o INSERT, a menos que o
--         formulário envie valores explícitos de estoque > 0.
-- ============================================================

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
  v_vol          jsonb;
  v_item         jsonb;
  v_volume_id    uuid;
  v_vol_qty      numeric;
  v_unit_type_id uuid;
  v_estoque      numeric;
  v_estoque_min  numeric;
  v_emb_id       uuid;
  v_is_acomp     boolean;
  v_idx          int;
  v_acomp_id     uuid;
  -- Preservação de estoque: mapa key→{estoque_atual, estoque_minimo}
  v_saved_estoques  jsonb := '{}'::jsonb;
  v_restore_key     text;
  v_saved           jsonb;
BEGIN
  UPDATE products SET category_id = p_category_id, is_active = p_is_active
  WHERE id = p_product_id AND company_id = p_company_id;

  -- Salva estoques atuais antes do delete, indexados por (volume_quantidade, id_unit_type)
  SELECT COALESCE(jsonb_object_agg(
    COALESCE(volume_quantidade::text, 'null') || ':' || COALESCE(id_unit_type::text, 'null'),
    jsonb_build_object(
      'estoque_atual',  estoque_atual,
      'estoque_minimo', estoque_minimo
    )
  ), '{}'::jsonb) INTO v_saved_estoques
  FROM product_volumes
  WHERE product_id = p_product_id AND company_id = p_company_id;

  DELETE FROM produto_embalagens WHERE produto_id = p_product_id AND company_id = p_company_id;
  DELETE FROM product_volumes WHERE product_id = p_product_id AND company_id = p_company_id;

  FOR v_vol IN SELECT * FROM jsonb_array_elements(p_volumes)
  LOOP
    v_vol_qty      := (v_vol->>'volume_quantidade')::numeric;
    v_unit_type_id := (v_vol->>'id_unit_type')::uuid;
    v_estoque      := 0;
    v_estoque_min  := 0;

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

      -- Coleta valores de estoque explicitamente informados no formulário
      IF (v_item->>'estoque') IS NOT NULL AND (v_item->>'estoque')::numeric > 0 THEN
        v_estoque := GREATEST(v_estoque, (v_item->>'estoque')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)));
      END IF;
      IF (v_item->>'estoque_minimo') IS NOT NULL AND (v_item->>'estoque_minimo')::numeric >= 0 THEN
        v_estoque_min := GREATEST(v_estoque_min, (v_item->>'estoque_minimo')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)));
      END IF;
    END LOOP;

    -- Decide o estoque final do novo product_volume:
    --   1. Formulário enviou estoque explícito → usa ele
    --   2. Não enviou → restaura o valor salvo antes do delete (mesmo (vol_qty, unit_type))
    v_restore_key := COALESCE(v_vol_qty::text, 'null') || ':' || COALESCE(v_unit_type_id::text, 'null');
    v_saved := COALESCE(v_saved_estoques, '{}'::jsonb) -> v_restore_key;

    IF v_estoque > 0 OR v_estoque_min > 0 THEN
      -- Explícito: usa o que veio do formulário
      UPDATE product_volumes
      SET estoque_atual = v_estoque, estoque_minimo = v_estoque_min, updated_at = now()
      WHERE id = v_volume_id;
    ELSIF v_saved IS NOT NULL THEN
      -- Não explícito: restaura saldo anterior
      UPDATE product_volumes
      SET estoque_atual  = COALESCE((v_saved->>'estoque_atual')::numeric,  0),
          estoque_minimo = COALESCE((v_saved->>'estoque_minimo')::numeric, 0),
          updated_at = now()
      WHERE id = v_volume_id;
    END IF;
    -- Se nem explícito nem salvo → fica 0 (novo volume sem histórico)

  END LOOP;
END;
$$;
