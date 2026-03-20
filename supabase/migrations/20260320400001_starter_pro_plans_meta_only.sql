-- ═══════════════════════════════════════════════════════════════════════════════
-- Planos Starter + Pro | Remove planos legados | Meta API only
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Remove planos legados (CASCADE limpa plan_features, feature_limits, subscriptions) ───

DELETE FROM subscriptions   WHERE plan_id IN (SELECT id FROM plans WHERE key IN ('bot','complete','full_erp','mini_erp','smoke_mini_erp'));
DELETE FROM plan_features   WHERE plan_id IN (SELECT id FROM plans WHERE key IN ('bot','complete','full_erp','mini_erp','smoke_mini_erp'));
DELETE FROM feature_limits  WHERE plan_id IN (SELECT id FROM plans WHERE key IN ('bot','complete','full_erp','mini_erp','smoke_mini_erp'));
DELETE FROM plans           WHERE key IN ('bot','complete','full_erp','mini_erp','smoke_mini_erp');

-- ─── 2. Insere planos novos (description já existe na tabela) ─────────────────

INSERT INTO plans (key, name, description) VALUES
  ('starter', 'Starter', 'Chatbot IA (Claude Haiku) · até 5.000 msgs/mês · R$ 297/mês'),
  ('pro',     'Pro',     'Chatbot IA (Claude Haiku) · impressão automática · até 10.000 msgs/mês · R$ 397/mês')
ON CONFLICT (key) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description;

-- ─── 3. Adiciona price_cents aos planos ───────────────────────────────────────

ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0;

UPDATE plans SET price_cents = 29700 WHERE key = 'starter';
UPDATE plans SET price_cents = 39700 WHERE key = 'pro';

-- ─── 4. Remove features exclusivas de ERP/fiscal (fora do escopo do chatbot) ─

DELETE FROM features WHERE key IN (
  'erp_full','fiscal_nfce','fiscal_nfe','fiscal_nfse',
  'tef','tef_transactions','invoices'
);

-- ─── 5. Insere features novas ─────────────────────────────────────────────────

INSERT INTO features (key, description) VALUES
  ('ai_parser',     'Parser de pedidos com IA (Claude Haiku)'),
  ('assisted_mode', 'Modo assistido com menu interativo WhatsApp')
ON CONFLICT (key) DO NOTHING;

-- ─── 6. Vincula features + limites aos planos ─────────────────────────────────

-- plan_features (flags booleanas — o que o plano HABILITA)
INSERT INTO plan_features (plan_id, feature_key)
SELECT p.id, f.key
FROM plans p, (VALUES
  ('starter', 'whatsapp_messages'),
  ('starter', 'ai_parser'),
  ('starter', 'assisted_mode'),
  ('pro',     'whatsapp_messages'),
  ('pro',     'ai_parser'),
  ('pro',     'assisted_mode'),
  ('pro',     'printing_auto'),
  ('pro',     'pdv')
) AS f(plan_key, key)
WHERE p.key = f.plan_key
ON CONFLICT DO NOTHING;

-- feature_limits (cotas mensais)
INSERT INTO feature_limits (plan_id, feature_key, limit_per_month)
SELECT p.id, f.key, f.lim
FROM plans p, (VALUES
  ('starter', 'whatsapp_messages', 5000),
  ('pro',     'whatsapp_messages', 10000)
) AS f(plan_key, key, lim)
WHERE p.key = f.plan_key
ON CONFLICT DO NOTHING;

-- ─── 7. Estende bot_logs com colunas de parser ────────────────────────────────

ALTER TABLE bot_logs
  ADD COLUMN IF NOT EXISTS parser_level     integer,      -- 1=Claude, 2=Regex, 3=Assistido
  ADD COLUMN IF NOT EXISTS fallback_used    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS response_time_ms integer;

COMMENT ON COLUMN bot_logs.parser_level     IS '1=Claude Haiku | 2=Regex | 3=Assistido';
COMMENT ON COLUMN bot_logs.fallback_used    IS 'true quando Claude falhou e outro parser assumiu';
COMMENT ON COLUMN bot_logs.response_time_ms IS 'Latência do parser em milissegundos';

-- ─── 8. Atualiza config do chatbot para Claude Haiku ─────────────────────────

UPDATE chatbots
SET config = jsonb_build_object(
  'provider',               'anthropic',
  'model',                  'claude-haiku-4-5-20251001',
  'threshold',              0.75,
  'fallback_chain',         jsonb_build_array('claude', 'regex', 'assisted'),
  'catalog_cache_ttl_min',  15,
  'max_retries',            2,
  'timeout_ms',             8000
);

-- Para novos chatbots criados sem config, garante o default
ALTER TABLE chatbots
  ALTER COLUMN config SET DEFAULT '{
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "threshold": 0.75,
    "fallback_chain": ["claude", "regex", "assisted"],
    "catalog_cache_ttl_min": 15,
    "max_retries": 2,
    "timeout_ms": 8000
  }';

-- ─── 9. Remove colunas Twilio de whatsapp_messages ────────────────────────────
-- 7 registros de teste com dados twilio — fase pré-produção, seguro remover

ALTER TABLE whatsapp_messages
  DROP COLUMN IF EXISTS twilio_message_sid,
  DROP COLUMN IF EXISTS twilio_account_sid;

-- Zera provider='twilio' nos registros existentes → 'meta' (dados de teste)
UPDATE whatsapp_messages SET provider = 'meta' WHERE provider = 'twilio';
UPDATE whatsapp_messages SET provider = 'meta' WHERE provider = '360dialog';

-- Nota: o enum whatsapp_provider mantém os valores antigos (Postgres não permite DROP de enum values)
-- mas nenhum novo registro usará 'twilio' ou '360dialog'

-- ─── 10. Índice para parser_level em bot_logs ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_bot_logs_parser_level ON bot_logs(company_id, parser_level, created_at DESC);

-- ─── FIM ─────────────────────────────────────────────────────────────────────
