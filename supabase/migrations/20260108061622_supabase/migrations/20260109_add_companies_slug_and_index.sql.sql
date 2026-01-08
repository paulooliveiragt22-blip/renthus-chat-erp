-- 2026_01_09_add_companies_slug_and_index.sql
-- 1) Adiciona coluna slug se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'companies'
      AND column_name = 'slug'
  ) THEN
    ALTER TABLE public.companies ADD COLUMN slug text;
  END IF;
END$$;

-- 2) Popula slug para linhas sem slug garantindo unicidade
-- Gera base_slug a partir de nome_fantasia ou razao_social (lower, non-alphanum -> '-')
WITH base AS (
  SELECT
    id,
    regexp_replace(lower(coalesce(nome_fantasia, razao_social)), '[^a-z0-9]+', '-', 'g') AS base_slug,
    created_at
  FROM public.companies
),
numbered AS (
  -- numerar por base_slug para permitir sufixo quando houver duplicatas
  SELECT id, base_slug,
         ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY created_at, id) AS rn
  FROM base
)
UPDATE public.companies c
SET slug = CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || '-' || n.rn END
FROM numbered n
WHERE c.id = n.id
  AND (c.slug IS NULL OR trim(c.slug) = '');

-- 3) (Reajusta eventuais espaços / hifenizações redundantes)
UPDATE public.companies
SET slug = regexp_replace(slug, '(^-|-$)+', '', 'g')
WHERE slug IS NOT NULL AND slug <> regexp_replace(slug, '(^-|-$)+', '', 'g');

-- 4) Cria índice único sobre lower(slug) (idempotente)
-- Usar lower(slug) evita colisão por case; IF NOT EXISTS evita erro se já existir
CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_idx
ON public.companies (lower(slug));
