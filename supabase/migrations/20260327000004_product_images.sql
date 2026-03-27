-- Migration: tabela de imagens de produtos + bucket Storage

CREATE TABLE IF NOT EXISTS public.product_images (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url          TEXT        NOT NULL,
  thumbnail_url TEXT,
  is_primary   BOOLEAN     NOT NULL DEFAULT false,
  file_size    INTEGER,    -- bytes da imagem otimizada
  uploaded_by  UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product
  ON public.product_images(product_id, is_primary);

-- Garante no máximo 1 primária por produto via trigger
CREATE OR REPLACE FUNCTION public.enforce_single_primary_image()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE public.product_images
    SET is_primary = false
    WHERE product_id = NEW.product_id
      AND id <> NEW.id
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_primary_image ON public.product_images;
CREATE TRIGGER trg_single_primary_image
  AFTER INSERT OR UPDATE OF is_primary ON public.product_images
  FOR EACH ROW WHEN (NEW.is_primary = true)
  EXECUTE FUNCTION public.enforce_single_primary_image();

-- RLS
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members can manage product images"
  ON public.product_images
  FOR ALL
  TO authenticated
  USING (
    product_id IN (
      SELECT id FROM public.products
      WHERE company_id IN (
        SELECT company_id FROM public.company_users
        WHERE user_id = auth.uid()
      )
    )
  );

-- Bucket Supabase Storage (idempotente)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$
BEGIN
  -- Upload: usuários autenticados
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'Authenticated users can upload product images'
  ) THEN
    CREATE POLICY "Authenticated users can upload product images"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'product-images');
  END IF;

  -- Read: público
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'Public can view product images'
  ) THEN
    CREATE POLICY "Public can view product images"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'product-images');
  END IF;

  -- Delete: autenticados
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'Authenticated users can delete product images'
  ) THEN
    CREATE POLICY "Authenticated users can delete product images"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'product-images');
  END IF;
END
$$;
