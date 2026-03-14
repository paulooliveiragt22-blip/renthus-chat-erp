-- ============================================================
-- MIGRATION: Triggers updated_at para tabelas que faltam
-- ============================================================
-- A função set_updated_at() já foi criada na migration 100004.
-- Aplicar a tabelas que têm updated_at mas não têm trigger.

-- orders (tem updated_at? não — só created_at e printed_at)
-- chatbots
DROP TRIGGER IF EXISTS trg_chatbots_updated_at ON public.chatbots;
CREATE TRIGGER trg_chatbots_updated_at
  BEFORE UPDATE ON public.chatbots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- chatbot_sessions
DROP TRIGGER IF EXISTS trg_chatbot_sessions_updated_at ON public.chatbot_sessions;
CREATE TRIGGER trg_chatbot_sessions_updated_at
  BEFORE UPDATE ON public.chatbot_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- company_integrations
DROP TRIGGER IF EXISTS trg_company_integrations_updated_at ON public.company_integrations;
CREATE TRIGGER trg_company_integrations_updated_at
  BEFORE UPDATE ON public.company_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bot_intents
DROP TRIGGER IF EXISTS trg_bot_intents_updated_at ON public.bot_intents;
CREATE TRIGGER trg_bot_intents_updated_at
  BEFORE UPDATE ON public.bot_intents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
