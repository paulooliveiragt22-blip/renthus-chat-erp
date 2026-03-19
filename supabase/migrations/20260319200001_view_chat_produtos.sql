-- ============================================================
-- view_chat_produtos: view unificada para o chatbot
-- Junta produto_embalagens + products + siglas_comerciais
-- Usada pelo processMessage.ts para listar produtos/embalagens
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
  sc.sigla AS sigla_comercial,
  p.name AS product_name,
  p.category_id,
  p.is_active,
  p.unit_type AS product_unit_type,
  p.details AS product_details
FROM public.produto_embalagens pe
JOIN public.products p ON p.id = pe.produto_id
JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
WHERE p.is_active = true;

COMMENT ON VIEW public.view_chat_produtos IS 'Produtos+embalagens para chatbot; junta produto_embalagens, products e siglas_comerciais. Filtra apenas produtos ativos.';
