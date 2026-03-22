-- ============================================================
-- view_chat_produtos: adiciona product_volume_id + remove descricao do tags_auto
--
-- product_volume_id é a chave técnica que identifica um volume distinto
-- dentro do mesmo produto (ex: Heineken 269ml, 330ml, 600ml).
-- O chatbot agrupa embalagens por (produto_id, product_volume_id) para
-- apresentar cada volume como uma variante separada.
--
-- descricao foi removido do tags_auto pois é campo livre do usuário e
-- pode conter erros; a busca passa a usar apenas campos técnicos.
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
  ut.sigla    AS unit_type_sigla,
  trim(concat_ws(' ',
    p.name,
    CASE WHEN pe.volume_quantidade > 0 THEN pe.volume_quantidade::text ELSE NULL END,
    ut.sigla,
    p.details,
    pe.tags
  )) AS tags_auto,
  pe.product_volume_id
FROM public.produto_embalagens pe
JOIN public.products          p  ON p.id  = pe.produto_id
JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
LEFT JOIN public.unit_types   ut ON ut.id  = pe.id_unit_type
WHERE p.is_active = true;

COMMENT ON VIEW public.view_chat_produtos IS
  'Produtos+embalagens para chatbot. Cada linha = 1 embalagem. Agrupar por (produto_id, product_volume_id) para obter variantes de volume distintas.';
