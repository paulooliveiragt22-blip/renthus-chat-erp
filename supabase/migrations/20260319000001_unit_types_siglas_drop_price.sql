-- ============================================================
-- unit_types + siglas_comerciais por empresa; produto_embalagens
-- passa a usar FKs + volume_quantidade; remove products.price e sigla_comercial texto
-- ============================================================

-- 1. Tabela unit_types (ml, L, kg, m etc. por empresa)
CREATE TABLE IF NOT EXISTS public.unit_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sigla character varying(20) NOT NULL,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, sigla)
);

CREATE INDEX IF NOT EXISTS idx_unit_types_company ON public.unit_types(company_id);

ALTER TABLE public.unit_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unit_types_select_for_members ON public.unit_types;
CREATE POLICY unit_types_select_for_members ON public.unit_types
  FOR SELECT USING (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

DROP POLICY IF EXISTS unit_types_insert_for_members ON public.unit_types;
CREATE POLICY unit_types_insert_for_members ON public.unit_types
  FOR INSERT WITH CHECK (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

DROP POLICY IF EXISTS unit_types_update_for_members ON public.unit_types;
CREATE POLICY unit_types_update_for_members ON public.unit_types
  FOR UPDATE USING (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

-- 2. Tabela siglas_comerciais (UN, CX, Fardo, Pacote etc. por empresa)
CREATE TABLE IF NOT EXISTS public.siglas_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sigla character varying(20) NOT NULL,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, sigla)
);

CREATE INDEX IF NOT EXISTS idx_siglas_comerciais_company ON public.siglas_comerciais(company_id);

ALTER TABLE public.siglas_comerciais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS siglas_comerciais_select_for_members ON public.siglas_comerciais;
CREATE POLICY siglas_comerciais_select_for_members ON public.siglas_comerciais
  FOR SELECT USING (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

DROP POLICY IF EXISTS siglas_comerciais_insert_for_members ON public.siglas_comerciais;
CREATE POLICY siglas_comerciais_insert_for_members ON public.siglas_comerciais
  FOR INSERT WITH CHECK (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

DROP POLICY IF EXISTS siglas_comerciais_update_for_members ON public.siglas_comerciais;
CREATE POLICY siglas_comerciais_update_for_members ON public.siglas_comerciais
  FOR UPDATE USING (
    company_id = (SELECT company_id FROM public.company_users WHERE user_id = auth.uid() AND is_active LIMIT 1)
  );

-- 3. Seed padrão: para cada empresa que já tem produto_embalagens + todas as companies
INSERT INTO public.unit_types (id, company_id, sigla, descricao)
SELECT gen_random_uuid(), c.id, u.sigla, u.descricao
FROM (
  SELECT DISTINCT company_id AS id FROM public.produto_embalagens
  UNION
  SELECT id FROM public.companies
) c
CROSS JOIN (VALUES ('ml','Mililitro'),('L','Litro'),('kg','Quilograma'),('m','Metro')) AS u(sigla, descricao)
ON CONFLICT (company_id, sigla) DO NOTHING;

INSERT INTO public.siglas_comerciais (id, company_id, sigla, descricao)
SELECT gen_random_uuid(), c.id, s.sigla, s.descricao
FROM (
  SELECT DISTINCT company_id AS id FROM public.produto_embalagens
  UNION
  SELECT id FROM public.companies
) c
CROSS JOIN (VALUES ('UN','Unidade'),('CX','Caixa'),('FARD','Fardo'),('PAC','Pacote')) AS s(sigla, descricao)
ON CONFLICT (company_id, sigla) DO NOTHING;

-- 4. Adicionar colunas em produto_embalagens
ALTER TABLE public.produto_embalagens
  ADD COLUMN IF NOT EXISTS id_sigla_comercial uuid REFERENCES public.siglas_comerciais(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS id_unit_type uuid REFERENCES public.unit_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS volume_quantidade numeric;

COMMENT ON COLUMN public.produto_embalagens.volume_quantidade IS 'Quantidade de volume (ex: 350 para 350ml); unidade em id_unit_type';

-- 5. Backfill id_sigla_comercial a partir de sigla_comercial
UPDATE public.produto_embalagens pe
SET id_sigla_comercial = sc.id
FROM public.siglas_comerciais sc
WHERE sc.company_id = pe.company_id
  AND upper(trim(sc.sigla)) = upper(trim(pe.sigla_comercial))
  AND pe.id_sigla_comercial IS NULL;

-- 6. Garantir que todos tenham id_sigla_comercial (fallback UN se sigla estranha)
UPDATE public.produto_embalagens pe
SET id_sigla_comercial = (SELECT id FROM public.siglas_comerciais WHERE company_id = pe.company_id AND upper(sigla) = 'UN' LIMIT 1)
WHERE pe.id_sigla_comercial IS NULL;

-- 7. Remover coluna texto sigla_comercial e tornar id_sigla_comercial NOT NULL
ALTER TABLE public.produto_embalagens ALTER COLUMN id_sigla_comercial SET NOT NULL;
ALTER TABLE public.produto_embalagens DROP COLUMN IF EXISTS sigla_comercial;

-- 8. Remover products.price (preço real está em produto_embalagens.preco_venda)
ALTER TABLE public.products DROP COLUMN IF EXISTS price;
