-- ============================================================
-- Views e RPCs para products/produto_embalagens
-- Acesso apenas via: SELECT em views, INSERT/UPDATE/DELETE via RPCs
-- ============================================================

-- ─── 1. VIEW: view_produtos_lista ─────────────────────────────────────────────
-- Uma linha por produto (UN como principal), com dados da embalagem UN e CX
CREATE OR REPLACE VIEW public.view_produtos_lista AS
WITH un_packs AS (
  SELECT pe.id, pe.company_id, pe.produto_id, pe.descricao, pe.fator_conversao, pe.preco_venda,
         pe.tags, pe.codigo_barras_ean, pe.is_acompanhamento, pe.codigo_interno,
         pe.id_sigla_comercial, pe.id_unit_type, pe.volume_quantidade,
         sc.sigla AS sigla_comercial, ut.sigla AS unit_type_sigla
  FROM produto_embalagens pe
  JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  LEFT JOIN unit_types ut ON ut.id = pe.id_unit_type
  WHERE upper(sc.sigla) IN ('UN', 'UNIDADE')
),
case_packs AS (
  SELECT DISTINCT ON (pe.produto_id)
    pe.id AS case_id, pe.produto_id, pe.descricao AS case_details, pe.fator_conversao AS case_qty,
    pe.preco_venda AS case_price, pe.id_sigla_comercial AS case_sigla_id, pe.codigo_interno AS case_codigo_interno
  FROM produto_embalagens pe
  JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  WHERE upper(sc.sigla) IN ('CX', 'CAIXA', 'FARD', 'PAC')
  ORDER BY pe.produto_id, CASE upper(sc.sigla) WHEN 'CX' THEN 1 WHEN 'CAIXA' THEN 2 WHEN 'FARD' THEN 3 ELSE 4 END
)
SELECT
  un.company_id,
  un.id,
  un.produto_id AS product_id,
  un.descricao AS details,
  un.id_unit_type,
  un.volume_quantidade AS volume_value,
  CASE WHEN un.unit_type_sigla = 'L' THEN 'l' WHEN un.unit_type_sigla IN ('ml','kg','m') THEN lower(un.unit_type_sigla) ELSE 'none' END AS unit,
  un.preco_venda AS unit_price,
  p.preco_custo_unitario AS cost_price,
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
  p.name AS product_name,
  p.category_id,
  c.name AS category_name
FROM un_packs un
JOIN products p ON p.id = un.produto_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN case_packs cp ON cp.produto_id = un.produto_id;

COMMENT ON VIEW public.view_produtos_lista IS 'Lista de produtos para /produtos: uma linha por produto (UN principal), com dados da CX se existir.';

-- ─── 2. VIEW: view_pdv_produtos ───────────────────────────────────────────────
-- Uma linha por embalagem (PDV, Pedidos, Financeiro) — codigo_interno da embalagem
CREATE OR REPLACE VIEW public.view_pdv_produtos AS
SELECT
  pe.id,
  pe.company_id,
  pe.produto_id,
  pe.descricao,
  pe.fator_conversao,
  pe.preco_venda,
  pe.codigo_interno,
  pe.codigo_barras_ean,
  pe.tags,
  pe.volume_quantidade,
  sc.sigla AS sigla_comercial,
  p.name AS product_name,
  p.is_active,
  p.unit_type AS product_unit_type,
  p.details AS product_details,
  p.preco_custo_unitario AS product_preco_custo,
  c.name AS category_name
FROM produto_embalagens pe
JOIN products p ON p.id = pe.produto_id
JOIN siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.is_active = true;

-- ─── 2b. VIEW: view_products_estoque ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_products_estoque AS
SELECT
  p.id,
  p.company_id,
  p.name,
  p.codigo_interno,
  p.details,
  p.preco_custo_unitario,
  p.estoque_atual,
  p.estoque_minimo,
  p.is_active,
  p.category_id,
  p.created_at,
  c.name AS category_name
FROM products p
LEFT JOIN categories c ON c.id = p.category_id;

COMMENT ON VIEW public.view_pdv_produtos IS 'Embalagens para PDV e Pedidos; codigo_interno vem da embalagem.';

-- ─── 3. VIEW: view_categories ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_categories AS
SELECT id, company_id, name, is_active, created_at
FROM categories;

-- ─── 4. VIEW: view_siglas_comerciais ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_siglas_comerciais AS
SELECT id, company_id, sigla, descricao, created_at
FROM siglas_comerciais;

-- ─── 5. VIEW: view_unit_types ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_unit_types AS
SELECT id, company_id, sigla, descricao, created_at
FROM unit_types;

-- ─── 6. VIEW: view_produto_embalagem_acompanhamentos ───────────────────────────
CREATE OR REPLACE VIEW public.view_produto_embalagem_acompanhamentos AS
SELECT id, produto_embalagem_id, acompanhamento_produto_embalagem_id, ordem, created_at
FROM produto_embalagem_acompanhamentos;

-- ─── 7. RPC: gerar_proximo_codigo_interno ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gerar_proximo_codigo_interno(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max int;
  v_next text;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(codigo_interno, '\D', '', 'g'), '')::int
  ), 0) + 1 INTO v_max
  FROM produto_embalagens
  WHERE company_id = p_company_id
    AND codigo_interno IS NOT NULL
    AND codigo_interno ~ '\d';

  IF v_max IS NULL THEN v_max := 1; END IF;
  v_next := 'INT-' || v_max::text;
  RETURN v_next;
END;
$$;

-- ─── 8. RPC: rpc_create_category ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_category(p_company_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO categories (company_id, name, is_active)
  VALUES (p_company_id, nullif(trim(p_name), ''), true)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── 9. RPC: rpc_create_sigla ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_sigla(
  p_company_id uuid, p_sigla text, p_descricao text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO siglas_comerciais (company_id, sigla, descricao)
  VALUES (p_company_id, upper(nullif(trim(p_sigla), '')), nullif(trim(p_descricao), ''))
  ON CONFLICT (company_id, sigla) DO UPDATE SET descricao = EXCLUDED.descricao
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── 10. RPC: rpc_update_product_estoque ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_update_product_estoque(
  p_product_id uuid, p_company_id uuid, p_estoque_atual numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products SET estoque_atual = p_estoque_atual
  WHERE id = p_product_id AND company_id = p_company_id;
END;
$$;

-- ─── 10b. RPC: rpc_toggle_product_active ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_toggle_product_active(
  p_product_id uuid, p_company_id uuid, p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products SET is_active = p_is_active
  WHERE id = p_product_id AND company_id = p_company_id;
END;
$$;

-- ─── 11. RPC: rpc_create_product_complete ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_product_complete(
  p_company_id uuid,
  p_name text,
  p_category_id uuid,
  p_codigo_interno text,
  p_preco_custo numeric,
  p_descricao_un text,
  p_id_sigla_un uuid,
  p_preco_venda_un numeric,
  p_is_active boolean DEFAULT true,
  p_tags text DEFAULT NULL,
  p_codigo_barras_ean text DEFAULT NULL,
  p_is_acompanhamento boolean DEFAULT false,
  p_id_unit_type uuid DEFAULT NULL,
  p_volume_quantidade numeric DEFAULT NULL,
  p_has_case boolean DEFAULT false,
  p_id_sigla_case uuid DEFAULT NULL,
  p_case_qty numeric DEFAULT NULL,
  p_case_price numeric DEFAULT NULL,
  p_case_descricao text DEFAULT NULL,
  p_codigo_interno_case text DEFAULT NULL,
  p_acompanhamento_ids uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_un_id uuid;
  v_preco_custo_prod numeric;
BEGIN
  v_preco_custo_prod := CASE
    WHEN p_has_case AND coalesce(p_case_qty, 0) > 0
    THEN p_preco_custo / p_case_qty
    ELSE p_preco_custo
  END;

  INSERT INTO products (company_id, name, category_id, codigo_interno, preco_custo_unitario, estoque_atual, estoque_minimo, is_active)
  VALUES (p_company_id, nullif(trim(p_name), ''), p_category_id, nullif(trim(p_codigo_interno), ''),
          v_preco_custo_prod, 0, 0, p_is_active)
  RETURNING id INTO v_product_id;

  INSERT INTO produto_embalagens (company_id, produto_id, id_sigla_comercial, descricao, fator_conversao, preco_venda,
    codigo_interno, codigo_barras_ean, tags, is_acompanhamento, id_unit_type, volume_quantidade)
  VALUES (p_company_id, v_product_id, p_id_sigla_un, nullif(trim(p_descricao_un), ''),
    1, p_preco_venda_un, nullif(trim(p_codigo_interno), ''), nullif(trim(p_codigo_barras_ean), ''),
    nullif(trim(p_tags), ''), p_is_acompanhamento, p_id_unit_type, p_volume_quantidade)
  RETURNING id INTO v_un_id;

  IF p_has_case AND p_id_sigla_case IS NOT NULL AND coalesce(p_case_qty, 0) > 0 THEN
    INSERT INTO produto_embalagens (company_id, produto_id, id_sigla_comercial, descricao, fator_conversao, preco_venda,
      codigo_interno, tags, is_acompanhamento)
    VALUES (p_company_id, v_product_id, p_id_sigla_case,
      coalesce(nullif(trim(p_case_descricao), ''), 'Embalagem ' || p_case_qty::int || 'un'),
      p_case_qty, coalesce(p_case_price, 0), nullif(trim(p_codigo_interno_case), ''),
      nullif(trim(p_tags), ''), p_is_acompanhamento);
  END IF;

  FOR i IN 1..least(array_length(p_acompanhamento_ids, 1), 2) LOOP
    IF p_acompanhamento_ids[i] IS NOT NULL AND p_acompanhamento_ids[i] <> v_un_id THEN
      INSERT INTO produto_embalagem_acompanhamentos (produto_embalagem_id, acompanhamento_produto_embalagem_id, ordem)
      VALUES (v_un_id, p_acompanhamento_ids[i], i);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('product_id', v_product_id, 'un_embalagem_id', v_un_id);
END;
$$;

-- ─── 12. RPC: rpc_update_product_edit ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_update_product_edit(
  p_company_id uuid,
  p_product_id uuid,
  p_category_id uuid,
  p_preco_custo numeric,
  p_is_active boolean,
  p_un_embalagem_id uuid,
  p_descricao text,
  p_preco_venda numeric,
  p_tags text,
  p_codigo_barras_ean text,
  p_is_acompanhamento boolean,
  p_id_unit_type uuid,
  p_volume_quantidade numeric,
  p_codigo_interno text,
  p_has_case boolean,
  p_id_sigla_case uuid,
  p_case_qty numeric,
  p_case_price numeric,
  p_case_descricao text,
  p_case_codigo_interno text,
  p_case_embalagem_id uuid,
  p_acompanhamento_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products SET category_id = p_category_id, preco_custo_unitario = p_preco_custo, is_active = p_is_active
  WHERE id = p_product_id AND company_id = p_company_id;

  UPDATE produto_embalagens SET
    descricao = nullif(trim(p_descricao), ''),
    preco_venda = p_preco_venda,
    tags = nullif(trim(p_tags), ''),
    codigo_barras_ean = nullif(trim(p_codigo_barras_ean), ''),
    is_acompanhamento = p_is_acompanhamento,
    id_unit_type = p_id_unit_type,
    volume_quantidade = p_volume_quantidade,
    codigo_interno = nullif(trim(p_codigo_interno), '')
  WHERE id = p_un_embalagem_id AND company_id = p_company_id;

  IF p_has_case AND p_id_sigla_case IS NOT NULL AND coalesce(p_case_qty, 0) > 0 THEN
    IF p_case_embalagem_id IS NOT NULL THEN
      UPDATE produto_embalagens SET
        descricao = coalesce(nullif(trim(p_case_descricao), ''), 'Embalagem ' || p_case_qty::int || 'un'),
        fator_conversao = p_case_qty, preco_venda = p_case_price,
        codigo_interno = nullif(trim(p_case_codigo_interno), ''),
        tags = nullif(trim(p_tags), ''), is_acompanhamento = p_is_acompanhamento
      WHERE id = p_case_embalagem_id AND company_id = p_company_id;
    ELSE
      INSERT INTO produto_embalagens (company_id, produto_id, id_sigla_comercial, descricao, fator_conversao, preco_venda, codigo_interno, tags, is_acompanhamento)
      VALUES (p_company_id, p_product_id, p_id_sigla_case,
        coalesce(nullif(trim(p_case_descricao), ''), 'Embalagem ' || p_case_qty::int || 'un'),
        p_case_qty, p_case_price, nullif(trim(p_case_codigo_interno), ''), nullif(trim(p_tags), ''), p_is_acompanhamento);
    END IF;
  ELSIF p_case_embalagem_id IS NOT NULL THEN
    DELETE FROM produto_embalagens WHERE id = p_case_embalagem_id AND company_id = p_company_id;
  END IF;

  DELETE FROM produto_embalagem_acompanhamentos WHERE produto_embalagem_id = p_un_embalagem_id;
  FOR i IN 1..least(array_length(p_acompanhamento_ids, 1), 2) LOOP
    IF p_acompanhamento_ids[i] IS NOT NULL AND p_acompanhamento_ids[i] <> p_un_embalagem_id THEN
      INSERT INTO produto_embalagem_acompanhamentos (produto_embalagem_id, acompanhamento_produto_embalagem_id, ordem)
      VALUES (p_un_embalagem_id, p_acompanhamento_ids[i], i);
    END IF;
  END LOOP;
END;
$$;
