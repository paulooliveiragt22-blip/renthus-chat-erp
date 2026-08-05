-- Busca fuzzy PT-BR no catálogo do chatbot (unaccent + trigram + tags_auto).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.rpc_search_chat_produtos(
  p_company_id uuid,
  p_query text,
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_q text := trim(coalesce(p_query, ''));
  v_q_norm text;
  v_q_stem text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 8), 20));
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF p_company_id IS NULL OR v_q = '' THEN
    RETURN jsonb_build_object('items', '[]'::jsonb);
  END IF;

  v_q_norm := lower(unaccent(v_q));
  v_q_stem := v_q_norm;
  IF right(v_q_stem, 2) = 'es' AND length(v_q_stem) > 5 THEN
    v_q_stem := left(v_q_stem, length(v_q_stem) - 2);
  ELSIF right(v_q_stem, 1) = 's' AND length(v_q_stem) > 4 THEN
    v_q_stem := left(v_q_stem, length(v_q_stem) - 1);
  END IF;

  WITH base AS (
    SELECT
      v.id,
      v.produto_id,
      v.product_name,
      v.display_name,
      v.descricao,
      v.detalhes,
      v.sigla_comercial,
      v.preco_venda,
      v.volume_quantidade,
      v.unit_type_sigla,
      v.fator_conversao,
      v.product_volume_id,
      v.category_id,
      v.estoque_unidades,
      v.vender_com_estoque_zero,
      v.thumbnail_url,
      v.image_url,
      greatest(
        similarity(lower(unaccent(coalesce(v.product_name, ''))), v_q_norm),
        similarity(lower(unaccent(coalesce(v.display_name, ''))), v_q_norm),
        similarity(lower(unaccent(coalesce(v.descricao, ''))), v_q_norm),
        similarity(lower(unaccent(coalesce(v.tags_auto, ''))), v_q_norm),
        similarity(lower(unaccent(coalesce(v.tags, ''))), v_q_norm),
        CASE
          WHEN lower(unaccent(coalesce(v.product_name, ''))) LIKE '%' || v_q_norm || '%' THEN 0.88
          WHEN lower(unaccent(coalesce(v.display_name, ''))) LIKE '%' || v_q_norm || '%' THEN 0.86
          WHEN lower(unaccent(coalesce(v.descricao, ''))) LIKE '%' || v_q_norm || '%' THEN 0.8
          WHEN lower(unaccent(coalesce(v.tags_auto, ''))) LIKE '%' || v_q_norm || '%' THEN 0.78
          WHEN v_q_stem <> v_q_norm
               AND lower(unaccent(coalesce(v.product_name, ''))) LIKE '%' || v_q_stem || '%' THEN 0.84
          WHEN v_q_stem <> v_q_norm
               AND lower(unaccent(coalesce(v.tags_auto, ''))) LIKE '%' || v_q_stem || '%' THEN 0.8
          ELSE 0
        END
      ) AS score
    FROM public.view_chat_produtos v
    WHERE v.company_id = p_company_id
      AND coalesce(v.item_is_active, true) = true
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'produto_id', b.produto_id,
        'product_name', b.product_name,
        'display_name', b.display_name,
        'descricao', b.descricao,
        'detalhes', b.detalhes,
        'sigla_comercial', b.sigla_comercial,
        'preco_venda', b.preco_venda,
        'volume_quantidade', b.volume_quantidade,
        'unit_type_sigla', b.unit_type_sigla,
        'fator_conversao', b.fator_conversao,
        'product_volume_id', b.product_volume_id,
        'category_id', b.category_id,
        'estoque_unidades', b.estoque_unidades,
        'vender_com_estoque_zero', b.vender_com_estoque_zero,
        'thumbnail_url', b.thumbnail_url,
        'image_url', b.image_url,
        'score', b.score
      )
      ORDER BY b.score DESC, b.product_name
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT *
    FROM base
    WHERE score >= 0.18
    ORDER BY score DESC, product_name
    LIMIT v_limit
  ) b;

  RETURN jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_search_chat_produtos(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_search_chat_produtos(uuid, text, integer) TO service_role;

COMMENT ON FUNCTION public.rpc_search_chat_produtos(uuid, text, integer) IS
  'Busca fuzzy de embalagens para chatbot: unaccent + trigram + tags_auto + stem plural simples.';
