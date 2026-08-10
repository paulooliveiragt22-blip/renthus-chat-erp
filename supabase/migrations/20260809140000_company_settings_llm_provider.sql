-- Migration: seleção de provider de IA por empresa (Claude vs GPT-5 mini)
-- Fase 0 do plano docs/PLANO_MULTI_PROVIDER_IA.md — só a coluna, sem lógica de leitura/escrita
-- ainda (isso vem na Fase 8). RLS de company_settings já cobre select/update por company_users,
-- não precisa de policy nova.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS llm_provider TEXT
  CHECK (llm_provider IS NULL OR llm_provider IN ('anthropic', 'openai'));

COMMENT ON COLUMN public.company_settings.llm_provider IS
  'Provider de IA escolhido pela empresa (anthropic|openai). NULL = usa default global (anthropic).';
