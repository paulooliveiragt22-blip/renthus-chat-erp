-- Adiciona product_volume_id em product_images para imagens por variante de tamanho
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS product_volume_id UUID
    REFERENCES public.product_volumes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_images_volume_id
  ON public.product_images(product_volume_id)
  WHERE product_volume_id IS NOT NULL;
