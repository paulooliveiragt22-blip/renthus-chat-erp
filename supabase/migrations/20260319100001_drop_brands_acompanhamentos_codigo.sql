-- ============================================================
-- 1. Remover brands e brand_id de products
-- 2. Adicionar codigo_interno em produto_embalagens (se não existir)
-- 3. Tabela produto_embalagem_acompanhamentos (até 2 produtos por embalagem)
-- 4. Garantir company_id em categories (multi-tenant)
-- ============================================================

-- 1. Remover brand_id de products e dropar tabela brands
ALTER TABLE public.products DROP COLUMN IF EXISTS brand_id;
DROP TABLE IF EXISTS public.brands CASCADE;

-- 4. Categories por empresa (se não tiver company_id)
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

-- 2. codigo_interno em produto_embalagens (para bipagem por embalagem)
ALTER TABLE public.produto_embalagens ADD COLUMN IF NOT EXISTS codigo_interno text;

-- 3. Tabela de acompanhamentos: embalagem A sugere até 2 embalagens B, C
CREATE TABLE IF NOT EXISTS public.produto_embalagem_acompanhamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_embalagem_id uuid NOT NULL REFERENCES public.produto_embalagens(id) ON DELETE CASCADE,
  acompanhamento_produto_embalagem_id uuid NOT NULL REFERENCES public.produto_embalagens(id) ON DELETE CASCADE,
  ordem smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(produto_embalagem_id, acompanhamento_produto_embalagem_id),
  CONSTRAINT chk_no_self_acomp CHECK (produto_embalagem_id <> acompanhamento_produto_embalagem_id)
);

CREATE INDEX IF NOT EXISTS idx_prod_emb_acomp_prod ON public.produto_embalagem_acompanhamentos(produto_embalagem_id);

-- Trigger: limitar a 2 acompanhamentos por produto_embalagem_id (verifica antes do INSERT)
CREATE OR REPLACE FUNCTION public.check_max_acompanhamentos()
RETURNS TRIGGER AS $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM public.produto_embalagem_acompanhamentos WHERE produto_embalagem_id = NEW.produto_embalagem_id;
  IF n >= 2 THEN
    RAISE EXCEPTION 'Máximo de 2 produtos de acompanhamento por embalagem';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_max_acompanhamentos ON public.produto_embalagem_acompanhamentos;
CREATE TRIGGER trg_check_max_acompanhamentos
  BEFORE INSERT ON public.produto_embalagem_acompanhamentos
  FOR EACH ROW EXECUTE FUNCTION public.check_max_acompanhamentos();
