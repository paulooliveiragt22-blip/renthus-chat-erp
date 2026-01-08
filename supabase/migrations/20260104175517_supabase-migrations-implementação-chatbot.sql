-- 1) chatbots: configurações por company
CREATE TABLE IF NOT EXISTS chatbots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  bot_type text NOT NULL DEFAULT 'llm', -- p.ex. 'llm' | 'rules'
  config jsonb NOT NULL DEFAULT '{}'::jsonb, -- provider, model, thresholds, etc
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chatbots_company_name_uq ON chatbots(company_id, name);

-- 2) bot_intents: intents/templates por company (opcional: examples for NLU)
CREATE TABLE IF NOT EXISTS bot_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  intent_key text NOT NULL, -- machine key, e.g., "order_status"
  name text,
  examples jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of example phrases
  response_template text, -- simple template with placeholders
  response_json jsonb, -- structured response if needed
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bot_intents_company_key_uq ON bot_intents(company_id, intent_key);

-- 3) bot_logs: auditoria / decisões / custo do LLM
CREATE TABLE IF NOT EXISTS bot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES whatsapp_threads(id) ON DELETE SET NULL,
  whatsapp_message_id uuid REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  direction text NOT NULL, -- 'inbound' | 'outbound' | 'decision'
  intent_key text,
  confidence numeric, -- classifier confidence (0..1)
  model_provider text, -- 'openai', 'anthropic', etc
  model_name text,     -- 'gpt-4.1', ...
  prompt jsonb,        -- stored prompt or input
  response_text text,  -- textual response sent (if any)
  response_json jsonb, -- structured response
  llm_tokens_used integer DEFAULT 0,
  llm_cost numeric(12,6) DEFAULT 0, -- optional cost accounting
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_logs_company_thread_idx ON bot_logs(company_id, thread_id);
CREATE INDEX IF NOT EXISTS bot_logs_whatsapp_msg_idx ON bot_logs(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS bot_logs_company_created_idx ON bot_logs(company_id, created_at);

-- :company_id e :used são parâmetros (used = número de mensagens ou tokens, conforme métrica)
-- Inicializa (de forma idempotente) o registro monthly de 'chatbot' com used = 0
-- para cada company que ainda não tiver um registro do mês corrente.
INSERT INTO public.usage_monthly (id, company_id, feature_key, year_month, used, created_at)
SELECT gen_random_uuid(), c.id, 'chatbot', to_char(CURRENT_DATE, 'YYYY-MM'), 0, now()
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.usage_monthly um
  WHERE um.company_id = c.id
    AND um.feature_key = 'chatbot'
    AND um.year_month = to_char(CURRENT_DATE, 'YYYY-MM')
);


-- 1) verificar possíveis conflitos (phones present in multiple companies)
SELECT phone_e164, count(DISTINCT company_id) AS companies_count
FROM whatsapp_threads
GROUP BY phone_e164
HAVING count(DISTINCT company_id) > 1;

-- 2) Se resultado vazio, podemos criar índice único composto:
-- cria índice único (sem CONCURRENTLY — roda dentro da transação do migration)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_threads_company_phone_uq
ON public.whatsapp_threads(company_id, phone_e164);


-- 3) Após testar, remover constraint/index antigo (careful!)
-- ALTER TABLE whatsapp_threads DROP CONSTRAINT whatsapp_threads_phone_e164_key;
-- Or drop index if exists (after ensuring no collisions)

-- Exemplo: permitir selects por company para usuários autenticados via claim renthus_company_id 
-- (apenas exemplo; ajuste conforme como seu cookie/rules expõem company_id)
ALTER TABLE chatbots ENABLE ROW LEVEL SECURITY;

CREATE POLICY chatbots_company_access ON chatbots
  USING (company_id = current_setting('renthus.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('renthus.company_id', true)::uuid);
