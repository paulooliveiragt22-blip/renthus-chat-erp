-- =============================================================================
-- Pagar.me Billing: pagarme_subscriptions, invoices, setup_payments
--
-- Nota: A tabela `subscriptions` existente (planos/features) é mantida.
-- O controle de ciclo de vida financeiro usa tabelas separadas com prefixo
-- `pagarme_` para evitar conflito.
-- =============================================================================

-- Enums (safe creation)
DO $$ BEGIN
  CREATE TYPE subscription_plan AS ENUM ('bot', 'complete');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE pagarme_sub_status AS ENUM ('trial', 'active', 'overdue', 'blocked', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE pagarme_invoice_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- -----------------------------------------------------------------------------
-- pagarme_subscriptions
-- Controla o ciclo de vida financeiro da assinatura de cada empresa.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagarme_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES companies(id) ON DELETE CASCADE,
  plan                subscription_plan NOT NULL,
  status              pagarme_sub_status NOT NULL DEFAULT 'trial',
  trial_ends_at       timestamptz NOT NULL,
  activated_at        timestamptz,
  next_billing_at     timestamptz,
  last_paid_at        timestamptz,
  pagarme_customer_id text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT pagarme_subscriptions_company_id_key UNIQUE (company_id)
);

-- -----------------------------------------------------------------------------
-- invoices — Faturas de mensalidade
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES companies(id) ON DELETE CASCADE,
  subscription_id     uuid REFERENCES pagarme_subscriptions(id) ON DELETE CASCADE,
  amount              numeric(10,2) NOT NULL,
  status              pagarme_invoice_status NOT NULL DEFAULT 'pending',
  due_at              timestamptz NOT NULL,
  paid_at             timestamptz,
  pagarme_order_id    text,
  pagarme_payment_url text,
  pix_qr_code         text,
  attempt_count       int DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- setup_payments — Pagamento do setup (taxa de ativação)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setup_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES companies(id) ON DELETE CASCADE,
  plan                subscription_plan NOT NULL,
  amount              numeric(10,2) NOT NULL,
  installments        int NOT NULL DEFAULT 1,
  status              pagarme_invoice_status NOT NULL DEFAULT 'pending',
  paid_at             timestamptz,
  pagarme_order_id    text,
  pagarme_payment_url text,
  created_at          timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pagarme_sub_company    ON pagarme_subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_pagarme_sub_status     ON pagarme_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_pagarme_sub_next_bill  ON pagarme_subscriptions(next_billing_at);
CREATE INDEX IF NOT EXISTS idx_invoices_company       ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sub           ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status        ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_at        ON invoices(due_at);
CREATE INDEX IF NOT EXISTS idx_setup_company          ON setup_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_setup_pagarme_order    ON setup_payments(pagarme_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_pagarme_order ON invoices(pagarme_order_id);

-- RLS
ALTER TABLE pagarme_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE setup_payments         ENABLE ROW LEVEL SECURITY;

-- Service role full access (crons, webhooks, API routes usam service role)
CREATE POLICY "service_role_pagarme_sub_all"
  ON pagarme_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_invoices_all"
  ON invoices FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_setup_payments_all"
  ON setup_payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_pagarme_sub_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pagarme_sub_updated_at ON pagarme_subscriptions;
CREATE TRIGGER pagarme_sub_updated_at
  BEFORE UPDATE ON pagarme_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_pagarme_sub_updated_at();
