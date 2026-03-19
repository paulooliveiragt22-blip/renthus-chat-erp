-- ============================================================
-- product_volumes: estoque por volume; UN e CX compartilham
-- Regra: estoque em unidades base (UN); CX usa fator_conversao
-- ============================================================

-- 1. Criar tabela product_volumes
CREATE TABLE IF NOT EXISTS public.product_volumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  volume_quantidade numeric,
  id_unit_type uuid REFERENCES public.unit_types(id) ON DELETE SET NULL,
  estoque_atual numeric NOT NULL DEFAULT 0,
  estoque_minimo numeric NOT NULL DEFAULT 0,
  preco_custo numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_volumes_company ON public.product_volumes(company_id);
CREATE INDEX IF NOT EXISTS idx_product_volumes_product ON public.product_volumes(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_volumes_product_volume
  ON public.product_volumes(product_id, COALESCE(volume_quantidade::text, ''), COALESCE(id_unit_type::text, ''));

ALTER TABLE public.product_volumes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_volumes_select_for_members ON public.product_volumes;
CREATE POLICY product_volumes_select_for_members ON public.product_volumes
  FOR SELECT USING (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

DROP POLICY IF EXISTS product_volumes_insert_for_members ON public.product_volumes;
CREATE POLICY product_volumes_insert_for_members ON public.product_volumes
  FOR INSERT WITH CHECK (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

DROP POLICY IF EXISTS product_volumes_update_for_members ON public.product_volumes;
CREATE POLICY product_volumes_update_for_members ON public.product_volumes
  FOR UPDATE USING (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

-- 2. Adicionar product_volume_id em produto_embalagens
ALTER TABLE public.produto_embalagens
  ADD COLUMN IF NOT EXISTS product_volume_id uuid REFERENCES public.product_volumes(id) ON DELETE CASCADE;

-- 3. Migrar dados: criar product_volumes a partir dos produtos existentes
-- Para cada produto, agrupar embalagens por (volume_quantidade, id_unit_type)
-- UN define o volume; CX do mesmo produto usa o mesmo volume (herda do UN)
INSERT INTO public.product_volumes (company_id, product_id, volume_quantidade, id_unit_type, estoque_atual, estoque_minimo, preco_custo)
SELECT DISTINCT ON (p.id, COALESCE(un.volume_quantidade::text, ''), COALESCE(un.id_unit_type::text, ''))
  p.company_id, p.id, un.volume_quantidade, un.id_unit_type,
  COALESCE(p.estoque_atual, 0), COALESCE(p.estoque_minimo, 0), p.preco_custo_unitario
FROM public.products p
JOIN public.produto_embalagens un ON un.produto_id = p.id
JOIN public.siglas_comerciais sc ON sc.id = un.id_sigla_comercial
WHERE upper(sc.sigla) IN ('UN', 'UNIDADE')
  AND NOT EXISTS (
    SELECT 1 FROM public.product_volumes pv
    WHERE pv.product_id = p.id
      AND pv.volume_quantidade IS NOT DISTINCT FROM un.volume_quantidade
      AND pv.id_unit_type IS NOT DISTINCT FROM un.id_unit_type
  );

-- Garantir um product_volume por produto (caso não tenha UN)
INSERT INTO public.product_volumes (company_id, product_id, volume_quantidade, id_unit_type, estoque_atual, estoque_minimo, preco_custo)
SELECT p.company_id, p.id, NULL, NULL, COALESCE(p.estoque_atual, 0), COALESCE(p.estoque_minimo, 0), p.preco_custo_unitario
FROM public.products p
WHERE NOT EXISTS (SELECT 1 FROM public.product_volumes pv WHERE pv.product_id = p.id);

-- 4. Atualizar produto_embalagens com product_volume_id
-- UN: associa ao product_volume com mesmo volume
UPDATE public.produto_embalagens pe
SET product_volume_id = pv.id
FROM public.product_volumes pv,
     public.siglas_comerciais sc
WHERE pe.produto_id = pv.product_id
  AND pe.id_sigla_comercial = sc.id
  AND upper(sc.sigla) IN ('UN', 'UNIDADE')
  AND (
    (pe.volume_quantidade IS NOT DISTINCT FROM pv.volume_quantidade AND pe.id_unit_type IS NOT DISTINCT FROM pv.id_unit_type)
    OR (pv.volume_quantidade IS NULL AND pv.id_unit_type IS NULL AND pe.volume_quantidade IS NULL AND pe.id_unit_type IS NULL)
  )
  AND pe.product_volume_id IS NULL;

-- CX/FARD/PAC: usa o primeiro product_volume do mesmo produto
UPDATE public.produto_embalagens pe
SET product_volume_id = (
  SELECT pv.id FROM public.product_volumes pv
  WHERE pv.product_id = pe.produto_id
  ORDER BY pv.volume_quantidade NULLS LAST, pv.id_unit_type NULLS LAST
  LIMIT 1
)
FROM public.siglas_comerciais sc
WHERE pe.id_sigla_comercial = sc.id
  AND upper(sc.sigla) NOT IN ('UN', 'UNIDADE')
  AND pe.product_volume_id IS NULL;

-- 5. Resolver duplicatas de nome e criar unique em products(company_id, lower(trim(name)))
DO $$
DECLARE
  r RECORD;
  i int;
BEGIN
  FOR r IN (
    SELECT company_id, lower(trim(name)) AS nkey, array_agg(id ORDER BY created_at) AS ids
    FROM products
    WHERE name IS NOT NULL AND trim(name) <> ''
    GROUP BY company_id, lower(trim(name))
    HAVING count(*) > 1
  )
  LOOP
    FOR i IN 2..array_length(r.ids, 1) LOOP
      UPDATE products
      SET name = trim(name) || ' (' || i::text || ')'
      WHERE id = r.ids[i];
    END LOOP;
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS products_company_name_unique
  ON public.products (company_id, lower(trim(name)));

-- 6. RPC: atualizar estoque do volume
CREATE OR REPLACE FUNCTION public.rpc_update_product_volume_estoque(
  p_product_volume_id uuid,
  p_company_id uuid,
  p_estoque_atual numeric,
  p_estoque_minimo numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE product_volumes
  SET
    estoque_atual = p_estoque_atual,
    estoque_minimo = COALESCE(p_estoque_minimo, estoque_minimo),
    updated_at = now()
  WHERE id = p_product_volume_id AND company_id = p_company_id;
END;
$$;

-- 7. Manter rpc_update_product_estoque para compatibilidade (atualiza primeiro volume do produto)
CREATE OR REPLACE FUNCTION public.rpc_update_product_estoque(
  p_product_id uuid, p_company_id uuid, p_estoque_atual numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE product_volumes pv
  SET estoque_atual = p_estoque_atual, updated_at = now()
  FROM (SELECT id FROM product_volumes WHERE product_id = p_product_id AND company_id = p_company_id ORDER BY volume_quantidade NULLS LAST LIMIT 1) sub
  WHERE pv.id = sub.id;
  -- Fallback: se não houver product_volumes, atualizar products (legado)
  IF NOT FOUND THEN
    UPDATE products SET estoque_atual = p_estoque_atual
    WHERE id = p_product_id AND company_id = p_company_id;
  END IF;
END;
$$;

-- 8. View de estoque: uma linha por product_volume
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
  COALESCE(pv.preco_custo, p.preco_custo_unitario) AS preco_custo_unitario,
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
  SELECT pe.codigo_interno
  FROM public.produto_embalagens pe
  JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  WHERE pe.product_volume_id = pv.id AND upper(sc.sigla) IN ('UN', 'UNIDADE')
  LIMIT 1
) pe ON true;

COMMENT ON VIEW public.view_products_estoque IS 'Estoque por volume; UN e CX do mesmo volume compartilham. id = product_volumes.id.';

-- 9. RPC para listar produtos por nome (buscar ou criar)
CREATE OR REPLACE FUNCTION public.rpc_search_products_by_name(
  p_company_id uuid,
  p_search text,
  p_limit int DEFAULT 20
)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name
  FROM products p
  WHERE p.company_id = p_company_id
    AND (p_search IS NULL OR p_search = '' OR lower(p.name) LIKE '%' || lower(trim(p_search)) || '%')
  ORDER BY p.name
  LIMIT p_limit;
END;
$$;

-- 10. RPC criar produto com itens (novo fluxo)
CREATE OR REPLACE FUNCTION public.rpc_create_product_with_items(
  p_company_id uuid,
  p_name text,
  p_category_id uuid,
  p_preco_custo numeric,
  p_is_active boolean DEFAULT true,
  p_tags text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_volume_id uuid;
  v_item jsonb;
  v_sigla_id uuid;
  v_vol_qty numeric;
  v_unit_type_id uuid;
  v_estoque numeric := 0;
  v_estoque_min numeric := 0;
BEGIN
  IF nullif(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do produto é obrigatório';
  END IF;

  IF EXISTS (
    SELECT 1 FROM products
    WHERE company_id = p_company_id AND lower(trim(name)) = lower(trim(p_name))
  ) THEN
    RAISE EXCEPTION 'Produto com nome "%" já existe nesta empresa', trim(p_name);
  END IF;

  INSERT INTO products (company_id, name, category_id, preco_custo_unitario, estoque_atual, estoque_minimo, is_active)
  VALUES (p_company_id, nullif(trim(p_name), ''), p_category_id, COALESCE(p_preco_custo, 0), 0, 0, COALESCE(p_is_active, true))
  RETURNING id INTO v_product_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sigla_id := (v_item->>'id_sigla_comercial')::uuid;
    IF v_sigla_id IS NULL THEN CONTINUE; END IF;

    v_vol_qty := (v_item->>'volume_quantidade')::numeric;
    v_unit_type_id := (v_item->>'id_unit_type')::uuid;

    -- Criar product_volume na primeira iteração com volume (ou na primeira)
    IF v_volume_id IS NULL THEN
      INSERT INTO product_volumes (company_id, product_id, volume_quantidade, id_unit_type, estoque_atual, estoque_minimo, preco_custo)
      VALUES (p_company_id, v_product_id, v_vol_qty, v_unit_type_id, 0, 0, COALESCE(p_preco_custo, 0))
      RETURNING id INTO v_volume_id;
    END IF;

    INSERT INTO produto_embalagens (
      company_id, produto_id, product_volume_id, id_sigla_comercial,
      descricao, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean,
      tags, is_acompanhamento, id_unit_type, volume_quantidade
    ) VALUES (
      p_company_id, v_product_id, v_volume_id, v_sigla_id,
      nullif(trim(v_item->>'descricao'), ''),
      GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1)),
      COALESCE((v_item->>'preco_venda')::numeric, 0),
      nullif(trim(v_item->>'codigo_interno'), ''),
      nullif(trim(v_item->>'codigo_barras_ean'), ''),
      nullif(trim(p_tags), ''),
      COALESCE((v_item->>'is_acompanhamento')::boolean, false),
      v_unit_type_id, v_vol_qty
    );

    -- Estoque: se informado, converter para unidades base e atualizar volume
    IF (v_item->>'estoque') IS NOT NULL AND (v_item->>'estoque')::numeric > 0 THEN
      v_estoque := (v_item->>'estoque')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1));
    END IF;
    IF (v_item->>'estoque_minimo') IS NOT NULL AND (v_item->>'estoque_minimo')::numeric >= 0 THEN
      v_estoque_min := (v_item->>'estoque_minimo')::numeric * GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1));
    END IF;
  END LOOP;

  IF v_volume_id IS NOT NULL AND (v_estoque > 0 OR v_estoque_min > 0) THEN
    UPDATE product_volumes
    SET estoque_atual = GREATEST(estoque_atual, v_estoque), estoque_minimo = GREATEST(estoque_minimo, v_estoque_min), updated_at = now()
    WHERE id = v_volume_id;
  END IF;

  RETURN jsonb_build_object('product_id', v_product_id, 'product_volume_id', v_volume_id);
END;
$$;

-- 11. Trigger: debitar estoque em order_items (produto_embalagem -> product_volume)
CREATE OR REPLACE FUNCTION public.fn_debitar_estoque_embalagem()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_embalagem_id uuid;
  v_qty numeric;
  v_fator numeric;
  v_volume_id uuid;
  v_debito numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_embalagem_id := OLD.produto_embalagem_id;
    v_qty := -COALESCE(OLD.qty, OLD.quantity::numeric, 0);
  ELSIF TG_OP = 'UPDATE' THEN
    v_embalagem_id := NEW.produto_embalagem_id;
    v_qty := COALESCE(NEW.qty, NEW.quantity::numeric, 0) - COALESCE(OLD.qty, OLD.quantity::numeric, 0);
  ELSE
    v_embalagem_id := NEW.produto_embalagem_id;
    v_qty := COALESCE(NEW.qty, NEW.quantity::numeric, 0);
  END IF;

  IF v_embalagem_id IS NULL OR v_qty = 0 THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT pe.fator_conversao, pe.product_volume_id
  INTO v_fator, v_volume_id
  FROM produto_embalagens pe
  WHERE pe.id = v_embalagem_id;

  v_fator := COALESCE(v_fator, 1);
  v_debito := v_qty * v_fator;
  IF v_debito = 0 THEN RETURN COALESCE(NEW, OLD); END IF;

  IF v_volume_id IS NOT NULL THEN
    UPDATE product_volumes
    SET estoque_atual = GREATEST(0, estoque_atual - v_debito), updated_at = now()
    WHERE id = v_volume_id;
  ELSE
    -- Fallback: embalagem sem product_volume_id — debitar no primeiro volume do produto
    UPDATE product_volumes pv
    SET estoque_atual = GREATEST(0, pv.estoque_atual - v_debito), updated_at = now()
    WHERE pv.id = (
      SELECT pv2.id FROM product_volumes pv2
      JOIN produto_embalagens pe ON pe.produto_id = pv2.product_id
      WHERE pe.id = v_embalagem_id
      ORDER BY pv2.volume_quantidade NULLS LAST
      LIMIT 1
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_debitar_estoque_embalagem ON public.order_items;
CREATE TRIGGER trg_debitar_estoque_embalagem
  AFTER INSERT OR UPDATE OF qty, quantity, produto_embalagem_id OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_debitar_estoque_embalagem();
