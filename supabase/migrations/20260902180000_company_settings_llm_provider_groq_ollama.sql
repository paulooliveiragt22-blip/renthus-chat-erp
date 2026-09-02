-- Amplia CHECK de company_settings.llm_provider para ollama e groq.
-- A UI/API já aceitam os 4 providers; o CHECK antigo só tinha anthropic|openai
-- e bloqueava o upsert com "violates check constraint company_settings_llm_provider_check".

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_llm_provider_check;

ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_llm_provider_check
  CHECK (
    llm_provider IS NULL
    OR llm_provider IN ('anthropic', 'openai', 'ollama', 'groq')
  );

COMMENT ON COLUMN public.company_settings.llm_provider IS
  'Provider de IA por empresa (anthropic|openai|ollama|groq). NULL = default global (LLM_PROVIDER).';
