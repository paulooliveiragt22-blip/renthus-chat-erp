-- Migration: Uppercase product names and descriptions
-- Converts all existing product names and embalagem descriptions to UPPERCASE
-- and installs triggers to enforce uppercase on future inserts/updates.

-- ─── Update existing data ────────────────────────────────────────────────────
UPDATE public.products
SET name = UPPER(name)
WHERE name IS NOT NULL AND name <> UPPER(name);

UPDATE public.produto_embalagens
SET descricao = UPPER(descricao)
WHERE descricao IS NOT NULL AND descricao <> UPPER(descricao);

-- ─── Trigger: products.name always UPPERCASE ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_uppercase_product_name()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.name := UPPER(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uppercase_product_name ON public.products;
CREATE TRIGGER trg_uppercase_product_name
BEFORE INSERT OR UPDATE OF name ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trg_uppercase_product_name();

-- ─── Trigger: produto_embalagens.descricao always UPPERCASE ──────────────────
CREATE OR REPLACE FUNCTION public.trg_uppercase_embalagem_descricao()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.descricao IS NOT NULL THEN
    NEW.descricao := UPPER(NEW.descricao);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uppercase_embalagem_descricao ON public.produto_embalagens;
CREATE TRIGGER trg_uppercase_embalagem_descricao
BEFORE INSERT OR UPDATE OF descricao ON public.produto_embalagens
FOR EACH ROW EXECUTE FUNCTION public.trg_uppercase_embalagem_descricao();
