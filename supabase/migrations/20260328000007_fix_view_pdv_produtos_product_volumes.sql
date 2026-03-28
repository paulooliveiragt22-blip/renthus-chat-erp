-- Recria view_pdv_produtos usando product_volumes como fonte de verdade para volume
-- Antes: usava pe.volume_quantidade e pe.id_unit_type (cópias soltas, frequentemente NULL)
-- Agora: JOIN product_volumes pv via pe.product_volume_id → pv.volume_quantidade + pv.id_unit_type

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
  pe.product_volume_id,

  -- Volume: fonte real é product_volumes, não pe.volume_quantidade
  pv.volume_quantidade,
  pv.id_unit_type AS volume_id_unit_type,

  -- Volume formatado: "600 ml", "1 L", "350 ml"
  CASE
    WHEN pv.volume_quantidade IS NOT NULL AND ut.sigla IS NOT NULL
      THEN TRIM(pv.volume_quantidade::text || ' ' || ut.sigla)
    WHEN pv.volume_quantidade IS NOT NULL
      THEN pv.volume_quantidade::text
    ELSE NULL
  END AS volume_formatado,

  -- Sigla comercial: "UN", "CX", "FARD"
  sc.sigla AS sigla_comercial,

  -- Sigla humanizada para exibição
  CASE UPPER(TRIM(sc.sigla))
    WHEN 'CX'      THEN 'Caixa'
    WHEN 'UN'      THEN 'Unidade'
    WHEN 'UNIDADE' THEN 'Unidade'
    WHEN 'FARD'    THEN 'Fardo'
    WHEN 'PAC'     THEN 'Pacote'
    WHEN 'KG'      THEN 'Quilograma'
    WHEN 'G'       THEN 'Grama'
    WHEN 'L'       THEN 'Litro'
    WHEN 'ML'      THEN 'Mililitro'
    ELSE COALESCE(NULLIF(TRIM(sc.descricao), ''), sc.sigla)
  END AS sigla_humanizada,

  -- Contagem de vendas para ordenar mais vendidos
  COALESCE(sales.sales_count, 0)::bigint AS sales_count,

  -- Campos do produto
  p.name        AS product_name,
  p.is_active,
  p.unit_type   AS product_unit_type,
  p.details     AS product_details,
  p.preco_custo_unitario AS product_preco_custo,
  c.name        AS category_name

FROM produto_embalagens pe
JOIN products p
  ON p.id = pe.produto_id
JOIN siglas_comerciais sc
  ON sc.id = pe.id_sigla_comercial
LEFT JOIN product_volumes pv
  ON pv.id = pe.product_volume_id
LEFT JOIN unit_types ut
  ON ut.id = pv.id_unit_type
LEFT JOIN categories c
  ON c.id = p.category_id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(oi.quantity), 0)::bigint AS sales_count
  FROM order_items oi
  WHERE oi.produto_embalagem_id = pe.id
) sales ON true
WHERE p.is_active = true;

COMMENT ON VIEW public.view_pdv_produtos IS
  'Embalagens para PDV e Pedidos. Volume via product_volumes (fonte real). '
  'Inclui volume_formatado, sigla_humanizada e sales_count.';
