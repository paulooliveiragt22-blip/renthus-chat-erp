-- ============================================================
-- MIGRATION: Remover coluna products.category (legado, sempre NULL)
-- ============================================================
-- Todos os 14 produtos têm category=NULL.
-- A categoria real é gerenciada via category_id → FK → categories.
-- O index idx_products_category indexa uma coluna sempre NULL.

-- 1. Drop index legado
DROP INDEX IF EXISTS public.idx_products_category;

-- 2. Drop coluna legada
ALTER TABLE public.products DROP COLUMN IF EXISTS category;

COMMENT ON COLUMN public.products.category_id IS 'FK para categories. Única fonte de verdade para categoria do produto.';
