-- 2026_01_08_000000_create_companies_and_related.sql
-- Cria tabela companies, company_users, company_integrations e daily_company_metrics
-- Ajuste nomes/prefixos conforme seu padrão de migrations.

-- ========== EXTENSIONS ==========
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- para gen_random_uuid()

-- ========== TABLE: companies ==========
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  slug text, -- opcional: slug amigável
  email text,
  phone text,
  whatsapp_phone text,
  -- endereço, contato e outros dados variáveis ficam em jsonb para flexibilidade
  meta jsonb DEFAULT '{}'::jsonb,
  settings jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true
);

-- índices úteis
CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_idx ON public.companies (slug);
CREATE INDEX IF NOT EXISTS companies_name_idx ON public.companies (lower(name));

-- trigger para manter updated_at automático
CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_set_updated_at ON public.companies;
CREATE TRIGGER trg_companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ========== TABLE: company_users ==========
CREATE TABLE IF NOT EXISTS public.company_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- referencia auth.users(id) se quiser FK (depende do seu auth)
  role text NOT NULL DEFAULT 'member', -- 'owner'|'admin'|'member'
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- evita duplicidade de vínculo
CREATE UNIQUE INDEX IF NOT EXISTS company_users_company_user_unique ON public.company_users (company_id, user_id);

-- ========== TABLE: company_integrations ==========
CREATE TABLE IF NOT EXISTS public.company_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL, -- ex: 'whatsapp', 'payment', 'others'
  config jsonb DEFAULT '{}'::jsonb, -- armazena tokens, numbers, config
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_integrations_company_idx ON public.company_integrations(company_id);

-- trigger updated_at para integrations
DROP TRIGGER IF EXISTS trg_company_integrations_set_updated_at ON public.company_integrations;
CREATE TRIGGER trg_company_integrations_set_updated_at
  BEFORE UPDATE ON public.company_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ========== TABLE: daily_company_metrics ==========
-- Para relatórios/summary: simples e eficiente (agregados diários)
CREATE TABLE IF NOT EXISTS public.daily_company_metrics (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  day date NOT NULL,
  orders_count integer NOT NULL DEFAULT 0,
  revenue numeric(12,2) NOT NULL DEFAULT 0.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, day)
);

CREATE INDEX IF NOT EXISTS daily_company_metrics_company_day_idx ON public.daily_company_metrics(company_id, day);

-- trigger updated_at for daily metrics
DROP TRIGGER IF EXISTS trg_daily_company_metrics_set_updated_at ON public.daily_company_metrics;
CREATE TRIGGER trg_daily_company_metrics_set_updated_at
  BEFORE UPDATE ON public.daily_company_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ========== Row Level Security (RLS) - básico ==========
-- Habilita RLS; as policies abaixo são exemplos — ajuste conforme seu fluxo.
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_company_metrics ENABLE ROW LEVEL SECURITY;

-- Policy: permite SELECT em companies somente para usuários vinculados via company_users
CREATE POLICY companies_select_for_members ON public.companies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.companies.id
        AND cu.user_id = current_setting('jwt.claims.user_id', true)::uuid
        AND cu.is_active = true
    )
  );

-- Policy: não permitir inserts/updates via client; backend (service role) fará inserts.
-- Se quiser permitir inserts via API autenticada, libere com checagem apropriada.
CREATE POLICY companies_no_client_write ON public.companies
  FOR INSERT, UPDATE, DELETE
  USING (false)
  WITH CHECK (false);

-- company_users: permitir SELECT apenas se for o próprio usuário ou se for membro da mesma company (útil)
CREATE POLICY company_users_select ON public.company_users
  FOR SELECT
  USING (
    (user_id = current_setting('jwt.claims.user_id', true)::uuid)
    OR
    (EXISTS (
      SELECT 1 FROM public.company_users cu2
      WHERE cu2.company_id = public.company_users.company_id
        AND cu2.user_id = current_setting('jwt.claims.user_id', true)::uuid
        AND cu2.role IN ('owner','admin') AND cu2.is_active = true
    ))
  );

-- company_integrations: leitura permitida apenas para membros da company
CREATE POLICY company_integrations_select_for_members ON public.company_integrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.company_integrations.company_id
        AND cu.user_id = current_setting('jwt.claims.user_id', true)::uuid
        AND cu.is_active = true
    )
  );

-- daily metrics: leitura permitida para membros
CREATE POLICY daily_company_metrics_select_for_members ON public.daily_company_metrics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.daily_company_metrics.company_id
        AND cu.user_id = current_setting('jwt.claims.user_id', true)::uuid
        AND cu.is_active = true
    )
  );

-- Observação: policies acima assumem que você popula o claim `user_id` no JWT.
-- Em Supabase, o claim padrão é `sub` (auth.uid()); você pode adaptar: current_setting('jwt.claims.sub', true)
-- Exemplo: replace current_setting('jwt.claims.user_id', true) por current_setting('jwt.claims.sub', true)

