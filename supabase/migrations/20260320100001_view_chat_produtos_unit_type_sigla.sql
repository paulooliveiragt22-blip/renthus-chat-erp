-- ============================================================
-- view_chat_produtos: adiciona unit_type_sigla
-- Necessário para o chatbot exibir "Heineken 600ml" corretamente
-- sem depender do campo product_unit_type (que vem do produto pai).
-- ============================================================

CREATE OR REPLACE VIEW public.view_chat_produtos AS
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
  sc.sigla   AS sigla_comercial,
  p.name     AS product_name,
  p.category_id,
  p.is_active,
  p.unit_type AS product_unit_type,
  p.details   AS product_details,
  ut.sigla    AS unit_type_sigla        -- NOVO: "ml" | "L" | "kg" | null
FROM public.produto_embalagens pe
JOIN public.products         p  ON p.id  = pe.produto_id
JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
LEFT JOIN public.unit_types  ut ON ut.id  = pe.id_unit_type
WHERE p.is_active = true;

COMMENT ON VIEW public.view_chat_produtos IS
  'Produtos+embalagens para chatbot. Junta produto_embalagens, products, siglas_comerciais e unit_types. Filtra apenas produtos ativos.';
