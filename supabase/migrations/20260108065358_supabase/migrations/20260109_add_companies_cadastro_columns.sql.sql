-- 2026_01_09_add_companies_cadastro_columns.sql
-- Migration idempotente que adiciona as colunas necessárias para cadastro de empresas.

-- Helper: criar função set_updated_at se não existir (é usada por triggers)
CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Garante tabela companies (se por acaso não existir)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1) Adiciona colunas de cadastro (idempotente)
ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS cnpj text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS razao_social text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS nome_fantasia text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS whatsapp_phone text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS cep text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS endereco text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS numero text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS bairro text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS cidade text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS uf text;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS owner_id uuid;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS plan_id uuid;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;

-- 2) Garante trigger updated_at para companies
DROP TRIGGER IF EXISTS trg_companies_set_updated_at ON public.companies;
CREATE TRIGGER trg_companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- 3) Índices úteis (idempotente)
-- Índice único de CNPJ normalizado (só cria se a coluna existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies' AND column_name='cnpj'
  ) THEN
    -- Não usamos CONCURRENTLY aqui porque as migrations rodam em transação.
    -- Isso vai falhar se já houver duplicatas de CNPJ — ver passo de verificação abaixo.
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS companies_cnpj_unique ON public.companies (regexp_replace(cnpj, ''\D'', '''', ''g'')) WHERE cnpj IS NOT NULL';
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_idx
  ON public.companies (lower(slug));

CREATE INDEX IF NOT EXISTS companies_name_idx ON public.companies (lower(coalesce(nome_fantasia, razao_social, name)));
CREATE INDEX IF NOT EXISTS companies_cidade_idx ON public.companies (cidade);

-- 4) Garantir company_users existir (vínculo usuário↔empresa)
CREATE TABLE IF NOT EXISTS public.company_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role text NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS company_users_company_user_unique ON public.company_users (company_id, user_id);

-- 5) RLS / policies base (se quiser ativar aqui)
-- (Apenas criamos policies idempotentes; adapte mais tarde conforme seu modelo)
ALTER TABLE IF EXISTS public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select_for_members ON public.companies;
CREATE POLICY companies_select_for_members ON public.companies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.companies.id
        AND cu.user_id = current_setting('jwt.claims.sub', true)::uuid
        AND cu.is_active = true
    )
  );

-- Bloqueia escrita por client (Separado por operação)
DROP POLICY IF EXISTS companies_no_client_insert ON public.companies;
DROP POLICY IF EXISTS companies_no_client_update ON public.companies;
DROP POLICY IF EXISTS companies_no_client_delete ON public.companies;

CREATE POLICY companies_no_client_insert
  ON public.companies
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY companies_no_client_update
  ON public.companies
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

CREATE POLICY companies_no_client_delete
  ON public.companies
  FOR DELETE
  USING (false);

-- 6) Small cleanup / safety: ensure triggers exist on company_integrations/daily metrics if those tables exist
-- (we don't create those tables here, but if they exist, ensure trigger function exists)
-- not modifying other tables to avoid side effects

-- FIM da migration
