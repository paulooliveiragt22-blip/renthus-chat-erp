-- VIEW PDV: sigla humanizada, volume formatado, sales_count (mais vendidos no topo)
-- ============================================================
-- DROP necessário: PostgreSQL não permite alterar ordem de colunas com CREATE OR REPLACE

DROP VIEW IF EXISTS public.view_pdv_produtos;

CREATE VIEW public.view_pdv_produtos AS
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
  -- Sigla humanizada (CX->Caixa, UN->Unidade, etc.)
  CASE UPPER(TRIM(sc.sigla))
    WHEN 'CX' THEN 'Caixa'
    WHEN 'UN' THEN 'Unidade'
    WHEN 'UNIDADE' THEN 'Unidade'
    WHEN 'FARD' THEN 'Fardo'
    WHEN 'PAC' THEN 'Pacote'
    WHEN 'KG' THEN 'Quilograma'
    WHEN 'G' THEN 'Grama'
    WHEN 'L' THEN 'Litro'
    WHEN 'ML' THEN 'Mililitro'
    ELSE COALESCE(NULLIF(TRIM(sc.descricao), ''), sc.sigla)
  END AS sigla_humanizada,
  -- Volume formatado: quantidade + unidade (ex: "350 ml", "12")
  CASE
    WHEN pe.volume_quantidade IS NOT NULL AND ut.sigla IS NOT NULL
    THEN TRIM(pe.volume_quantidade::text || ' ' || ut.sigla)
    WHEN pe.volume_quantidade IS NOT NULL
    THEN pe.volume_quantidade::text
    ELSE NULL
  END AS volume_formatado,
  -- Contagem de vendas para ordenar mais vendidos no topo
  COALESCE(sales.sales_count, 0)::bigint AS sales_count,
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
LEFT JOIN unit_types ut ON ut.id = pe.id_unit_type
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(oi.quantity), 0)::bigint AS sales_count
  FROM order_items oi
  WHERE oi.produto_embalagem_id = pe.id
) sales ON true
WHERE p.is_active = true;

COMMENT ON VIEW public.view_pdv_produtos IS 'Embalagens para PDV e Pedidos; inclui sigla humanizada, volume formatado e sales_count.';
