-- Migration: SQL Functions para o Flow Catálogo
--
-- CORREÇÕES aplicadas vs o plano original:
--   1. products.category NÃO EXISTE — usa JOIN em categories c ON c.id = p.category_id
--   2. produto_embalagens.estoque_atual NÃO EXISTE — usa JOIN LATERAL em product_volumes
--   3. Removida referência a flow_sessions (usa chatbot_sessions.context)

-- ─── get_top_products_by_category ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_top_products_by_category(
  p_company_id  UUID,
  p_category    TEXT    DEFAULT NULL,
  p_limit       INT     DEFAULT 30,
  p_days        INT     DEFAULT 30
)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  description   TEXT,
  price         NUMERIC,
  image_url     TEXT,
  thumbnail_url TEXT,
  category      TEXT,
  sales_count   BIGINT,
  in_stock      BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.id,
    CONCAT(p.name, ' ', COALESCE(pe.descricao, ''), ' ',
           COALESCE(pe.volume_quantidade::TEXT, ''), COALESCE(ut.sigla, ''))   AS name,
    CONCAT(COALESCE(sc.sigla, ''), ' — ',
           CASE WHEN pe.fator_conversao > 1
                THEN pe.fator_conversao::TEXT || ' un'
                ELSE 'Unidade'
           END)                                                                 AS description,
    pe.preco_venda                                                              AS price,
    COALESCE(MAX(pi.img_url),
      'https://via.placeholder.com/200?text=' || REPLACE(p.name, ' ', '+'))    AS image_url,
    COALESCE(MAX(pi.img_thumb), MAX(pi.img_url),
      'https://via.placeholder.com/200?text=' || REPLACE(p.name, ' ', '+'))    AS thumbnail_url,
    COALESCE(c.name, 'Outros')                                                 AS category,
    COUNT(oi.id)                                                               AS sales_count,
    -- estoque via product_volumes (campo correto)
    COALESCE((
      SELECT pv.estoque_atual > 0
      FROM public.product_volumes pv
      WHERE pv.id = pe.product_volume_id
      LIMIT 1
    ), false)                                                                   AS in_stock
  FROM public.produto_embalagens pe
  INNER JOIN public.products p      ON p.id = pe.produto_id
  LEFT  JOIN public.categories c    ON c.id = p.category_id
  LEFT  JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  LEFT  JOIN public.unit_types ut   ON ut.id = pe.id_unit_type
  LEFT  JOIN public.order_items oi  ON oi.produto_embalagem_id = pe.id
  LEFT  JOIN public.orders o
          ON o.id = oi.order_id
         AND o.created_at > NOW() - (INTERVAL '1 day' * p_days)
  LEFT  JOIN LATERAL (
    SELECT pimg.url AS img_url, pimg.thumbnail_url AS img_thumb
    FROM   public.product_images pimg
    WHERE  pimg.product_id = p.id AND pimg.is_primary = true
    LIMIT  1
  ) pi ON true
  WHERE pe.company_id = p_company_id
    AND p.is_active   = true
    AND (p_category IS NULL OR c.name ILIKE p_category)
  GROUP BY pe.id, p.name, pe.descricao, pe.volume_quantidade,
           ut.sigla, sc.sigla, pe.fator_conversao, pe.preco_venda,
           c.name, pe.product_volume_id
  ORDER BY sales_count DESC NULLS LAST, pe.preco_venda DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── get_customer_favorites ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_customer_favorites(
  p_company_id      UUID,
  p_customer_phone  TEXT,
  p_limit           INT DEFAULT 5
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  description     TEXT,
  price           NUMERIC,
  image_url       TEXT,
  thumbnail_url   TEXT,
  order_count     INT,
  last_ordered_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.id,
    CONCAT(p.name, ' ', COALESCE(pe.descricao, ''), ' ',
           COALESCE(pe.volume_quantidade::TEXT, ''), COALESCE(ut.sigla, ''))   AS name,
    CONCAT(COALESCE(sc.sigla, ''), ' — ',
           CASE WHEN pe.fator_conversao > 1
                THEN pe.fator_conversao::TEXT || ' un'
                ELSE 'Unidade'
           END)                                                                 AS description,
    pe.preco_venda                                                              AS price,
    COALESCE(pi.url, 'https://via.placeholder.com/200?text=' ||
             REPLACE(p.name, ' ', '+'))                                        AS image_url,
    COALESCE(pi.thumbnail_url, pi.url)                                         AS thumbnail_url,
    cf.order_count::INT,
    cf.last_ordered_at
  FROM public.customer_favorites cf
  INNER JOIN public.produto_embalagens pe ON pe.id = cf.produto_embalagem_id
  INNER JOIN public.products p            ON p.id  = pe.produto_id
  LEFT  JOIN public.siglas_comerciais sc  ON sc.id = pe.id_sigla_comercial
  LEFT  JOIN public.unit_types ut         ON ut.id = pe.id_unit_type
  LEFT  JOIN LATERAL (
    SELECT url, thumbnail_url
    FROM   public.product_images
    WHERE  product_id = p.id AND is_primary = true
    LIMIT  1
  ) pi ON true
  WHERE cf.company_id      = p_company_id
    AND cf.customer_phone  = p_customer_phone
    AND p.is_active        = true
  ORDER BY cf.order_count DESC, cf.last_ordered_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── cleanup de sessions expiradas (substitui flow_sessions) ──────────────────
-- chatbot_sessions já tem expires_at — limpeza usa o mesmo campo
DROP FUNCTION IF EXISTS public.cleanup_expired_chatbot_sessions();
CREATE OR REPLACE FUNCTION public.cleanup_expired_chatbot_sessions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.chatbot_sessions
  WHERE expires_at < NOW();
END;
$$;
