-- Migration: Adiciona colunas de onboarding à tabela companies

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS onboarding_token           uuid         DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS onboarding_completed_at    timestamptz,
    ADD COLUMN IF NOT EXISTS email_verified             boolean      DEFAULT false,
    ADD COLUMN IF NOT EXISTS senha_definida             boolean      DEFAULT false,
    ADD COLUMN IF NOT EXISTS activation_requested_at    timestamptz;

-- Index para lookup rápido por token
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_onboarding_token
    ON public.companies(onboarding_token)
    WHERE onboarding_token IS NOT NULL;

-- Garante que empresas existentes tenham token gerado
UPDATE public.companies
SET onboarding_token = gen_random_uuid()
WHERE onboarding_token IS NULL;
