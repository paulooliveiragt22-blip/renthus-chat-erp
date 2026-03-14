-- ============================================================
-- MIGRATION: Limpar schema de companies (colunas duplicadas/mortas)
-- ============================================================

-- 1. Consolidar city → cidade
--    (cidade tem index, é a coluna canônica PT-BR)
UPDATE public.companies
SET cidade = city
WHERE city IS NOT NULL AND cidade IS NULL;

-- 2. Dropar city (redundante com cidade)
ALTER TABLE public.companies DROP COLUMN IF EXISTS city;

-- 3. Dropar companies.plan_id (sempre NULL, nunca lido pelo app)
--    O plano da empresa é gerenciado exclusivamente por subscriptions
ALTER TABLE public.companies DROP COLUMN IF EXISTS plan_id;

-- 4. Adicionar trigger para auto-atualizar updated_at em companies
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 5. Aplicar o mesmo trigger a subscriptions (sem updated_at trigger)
-- subscriptions não tem updated_at column, pular

COMMENT ON COLUMN public.companies.cidade IS 'Cidade da empresa (canônico, campo cidade_idx indexado).';
COMMENT ON COLUMN public.companies.nome_fantasia IS 'Nome fantasia / razão social comercial.';
COMMENT ON COLUMN public.companies.razao_social IS 'Razão social legal (CNPJ).';
