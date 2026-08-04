-- Parte 2/2: planos, features, carteira IA (após enum commitado)

INSERT INTO public.plans (key, name, description, price_cents) VALUES
  ('essencial', 'Essencial', 'WhatsApp + cardápio web + IA com crédito e packs · R$ 197/mês', 19700),
  ('pro',       'Pro',       'ERP completo + impressão automática + IA · R$ 279/mês', 27900),
  ('market',    'Market',    'Pro + iFood/Aiqfome + Instagram/Messenger + mesa + app · R$ 349/mês', 34900)
ON CONFLICT (key) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents;

UPDATE public.subscriptions s
SET plan_id = (SELECT id FROM public.plans WHERE key = 'essencial' LIMIT 1)
WHERE s.plan_id IN (SELECT id FROM public.plans WHERE key = 'starter');

UPDATE public.plans
SET name = 'Essencial (legado)', description = 'Migrado para essencial', price_cents = 19700
WHERE key = 'starter';

UPDATE public.plans SET price_cents = 27900, name = 'Pro',
  description = 'ERP completo + impressão automática + IA · R$ 279/mês'
WHERE key = 'pro';

UPDATE public.pagarme_subscriptions
SET plan = 'essencial'
WHERE plan::text = 'bot';

UPDATE public.pagarme_subscriptions
SET plan = 'pro'
WHERE plan::text = 'complete';

INSERT INTO public.features (key, description) VALUES
  ('web_menu',                  'Cardápio web público'),
  ('ai_credit_packs',           'Packs de crédito IA (R$10/20/50)'),
  ('pdv_basic',                 'PDV básico'),
  ('estoque_full',              'Estoque completo'),
  ('financeiro_full',           'Financeiro completo'),
  ('marketplace_ifood',         'Integração iFood (próxima versão)'),
  ('marketplace_aiqfome',       'Integração Aiqfome (próxima versão)'),
  ('omnichannel_ig_messenger',  'Chatbot Instagram + Messenger (próxima versão)'),
  ('table_service',             'Atendimento de mesa / salão (próxima versão)'),
  ('mobile_app',                'App Flutter (próxima versão)')
ON CONFLICT (key) DO NOTHING;

DELETE FROM public.plan_features
WHERE plan_id IN (SELECT id FROM public.plans WHERE key IN ('essencial', 'pro', 'market', 'starter'));

INSERT INTO public.plan_features (plan_id, feature_key)
SELECT p.id, f.key
FROM public.plans p
CROSS JOIN LATERAL (
  VALUES
    ('essencial', 'whatsapp_messages'),
    ('essencial', 'ai_parser'),
    ('essencial', 'assisted_mode'),
    ('essencial', 'web_menu'),
    ('essencial', 'ai_credit_packs'),
    ('essencial', 'pdv_basic'),
    ('pro', 'whatsapp_messages'),
    ('pro', 'ai_parser'),
    ('pro', 'assisted_mode'),
    ('pro', 'web_menu'),
    ('pro', 'ai_credit_packs'),
    ('pro', 'pdv'),
    ('pro', 'printing_auto'),
    ('pro', 'estoque_full'),
    ('pro', 'financeiro_full'),
    ('market', 'whatsapp_messages'),
    ('market', 'ai_parser'),
    ('market', 'assisted_mode'),
    ('market', 'web_menu'),
    ('market', 'ai_credit_packs'),
    ('market', 'pdv'),
    ('market', 'printing_auto'),
    ('market', 'estoque_full'),
    ('market', 'financeiro_full'),
    ('market', 'marketplace_ifood'),
    ('market', 'marketplace_aiqfome'),
    ('market', 'omnichannel_ig_messenger'),
    ('market', 'table_service'),
    ('market', 'mobile_app')
) AS f(plan_key, key)
WHERE p.key = f.plan_key
ON CONFLICT DO NOTHING;

DELETE FROM public.feature_limits
WHERE plan_id IN (SELECT id FROM public.plans WHERE key IN ('essencial', 'pro', 'market', 'starter'));

INSERT INTO public.feature_limits (plan_id, feature_key, limit_per_month)
SELECT p.id, 'whatsapp_messages', lim
FROM public.plans p
CROSS JOIN LATERAL (
  VALUES ('essencial', 8000), ('pro', 20000), ('market', 40000)
) AS f(plan_key, lim)
WHERE p.key = f.plan_key
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.company_ai_wallets (
    company_id              uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    period_ym               text NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM'),
    included_budget_cents   integer NOT NULL DEFAULT 0,
    included_spent_cents    integer NOT NULL DEFAULT 0,
    prepaid_balance_cents   integer NOT NULL DEFAULT 0,
    auto_recharge_enabled   boolean NOT NULL DEFAULT false,
    auto_recharge_pack_cents integer NULL
        CHECK (auto_recharge_pack_cents IS NULL OR auto_recharge_pack_cents IN (1000, 2000, 5000)),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_ai_wallets IS
  'Crédito IA: incluso (10% do plano/mês) + prepaid packs. Sem crédito trava só a IA.';

CREATE TABLE IF NOT EXISTS public.company_ai_ledger (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('included_debit', 'prepaid_debit', 'pack_credit', 'period_reset', 'adjust')),
    amount_cents integer NOT NULL,
    meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_ai_ledger_company_created_idx
    ON public.company_ai_ledger (company_id, created_at DESC);

ALTER TABLE public.company_ai_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_ai_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_ai_wallets_service ON public.company_ai_wallets;
CREATE POLICY company_ai_wallets_service ON public.company_ai_wallets
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS company_ai_ledger_service ON public.company_ai_ledger;
CREATE POLICY company_ai_ledger_service ON public.company_ai_ledger
    FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.company_ai_wallets (company_id, period_ym, included_budget_cents)
SELECT s.company_id,
       to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM'),
       GREATEST(0, (p.price_cents * 10) / 100)
FROM public.subscriptions s
JOIN public.plans p ON p.id = s.plan_id
WHERE s.status = 'active'
ON CONFLICT (company_id) DO NOTHING;
