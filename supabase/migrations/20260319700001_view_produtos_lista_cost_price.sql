-- ============================================================
-- view_produtos_lista: usar preco_custo de produto_embalagens
-- (custo por item) em vez de products.preco_custo_unitario
-- ============================================================

CREATE OR REPLACE VIEW public.view_produtos_lista AS
WITH un_packs AS (
  SELECT pe.id, pe.company_id, pe.produto_id, pe.descricao, pe.fator_conversao, pe.preco_venda,
         pe.preco_custo, pe.tags, pe.codigo_barras_ean, pe.is_acompanhamento, pe.codigo_interno,
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
  p.name AS product_name,
  p.category_id,
  c.name AS category_name
FROM un_packs un
JOIN products p ON p.id = un.produto_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN case_packs cp ON cp.produto_id = un.produto_id;
