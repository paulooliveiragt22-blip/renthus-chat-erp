-- ─── 1. Corrige get_top_products_by_category ───────────────────────────────────
-- Problemas anteriores:
--   - name incluía pe.descricao → aparecia no title do Flow
--   - in_stock retornava false para produtos sem product_volume_id (COALESCE padrão errado)
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
    p.name                                                                       AS name,
    CONCAT(COALESCE(sc.sigla, ''), ' — ',
           CASE WHEN pe.fator_conversao > 1
                THEN pe.fator_conversao::TEXT || ' un'
                ELSE 'Unidade'
           END)                                                                  AS description,
    pe.preco_venda                                                               AS price,
    COALESCE(MAX(pi.img_url), NULL)                                              AS image_url,
    COALESCE(MAX(pi.img_thumb), MAX(pi.img_url), NULL)                          AS thumbnail_url,
    COALESCE(c.name, 'Outros')                                                  AS category,
    COUNT(oi.id)                                                                AS sales_count,
    -- true por padrão; false apenas se product_volume existe E estoque = 0
    COALESCE((
      SELECT pv.estoque_atual > 0
      FROM public.product_volumes pv
      WHERE pv.id = pe.product_volume_id
      LIMIT 1
    ), true)                                                                     AS in_stock
  FROM public.produto_embalagens pe
  INNER JOIN public.products p       ON p.id  = pe.produto_id
  LEFT  JOIN public.categories c     ON c.id  = p.category_id
  LEFT  JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
  LEFT  JOIN public.unit_types ut    ON ut.id = pe.id_unit_type
  LEFT  JOIN public.order_items oi   ON oi.produto_embalagem_id = pe.id
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
  GROUP BY pe.id, p.name, pe.volume_quantidade,
           ut.sigla, sc.sigla, pe.fator_conversao, pe.preco_venda,
           c.name, pe.product_volume_id
  ORDER BY sales_count DESC NULLS LAST, p.name
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── 2. Bucket product-images público ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Política: leitura pública (sem autenticação) — necessário para URLs nos Flows
DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;
CREATE POLICY "product_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

-- Política: escrita apenas para service_role (uploads via admin)
DROP POLICY IF EXISTS "product_images_service_write" ON storage.objects;
CREATE POLICY "product_images_service_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "product_images_service_update" ON storage.objects;
CREATE POLICY "product_images_service_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images' AND auth.role() = 'service_role');

DROP POLICY IF EXISTS "product_images_service_delete" ON storage.objects;
CREATE POLICY "product_images_service_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND auth.role() = 'service_role');
