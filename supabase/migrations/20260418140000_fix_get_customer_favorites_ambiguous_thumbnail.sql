-- Corrige 42702 "column reference thumbnail_url is ambiguous" em get_customer_favorites:
-- em PL/pgSQL RETURN QUERY, os nomes de RETURNS TABLE entram no namespace do SELECT e
-- colidem com pi.thumbnail_url / pi.url vindos do LATERAL.

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
    COALESCE(pim.img_url, 'https://via.placeholder.com/200?text=' ||
             REPLACE(p.name, ' ', '+'))                                        AS image_url,
    COALESCE(pim.img_thumb, pim.img_url)                                        AS thumbnail_url,
    cf.order_count::INT,
    cf.last_ordered_at
  FROM public.customer_favorites cf
  INNER JOIN public.produto_embalagens pe ON pe.id = cf.produto_embalagem_id
  INNER JOIN public.products p            ON p.id  = pe.produto_id
  LEFT  JOIN public.siglas_comerciais sc  ON sc.id = pe.id_sigla_comercial
  LEFT  JOIN public.unit_types ut         ON ut.id = pe.id_unit_type
  LEFT  JOIN LATERAL (
    SELECT pim_inner.url AS img_url, pim_inner.thumbnail_url AS img_thumb
    FROM   public.product_images pim_inner
    WHERE  pim_inner.product_id = p.id AND pim_inner.is_primary = true
    LIMIT  1
  ) pim ON true
  WHERE cf.company_id      = p_company_id
    AND cf.customer_phone  = p_customer_phone
    AND p.is_active        = true
  ORDER BY cf.order_count DESC, cf.last_ordered_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
