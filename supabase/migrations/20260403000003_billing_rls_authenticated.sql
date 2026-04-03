-- RLS: leitura autenticada em tabelas de billing
-- Owners/admins podem ler os dados de cobrança da própria empresa.
-- Escrita continua sendo somente via service_role (rotas de API e cron).

-- Helper: retorna o company_id do usuário autenticado atual
CREATE OR REPLACE FUNCTION auth_user_company_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
    FROM company_users
   WHERE user_id = auth.uid()
   LIMIT 1
$$;

-- ── pagarme_subscriptions ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_read_own_pagarme_sub" ON pagarme_subscriptions;
CREATE POLICY "authenticated_read_own_pagarme_sub"
  ON pagarme_subscriptions FOR SELECT TO authenticated
  USING (company_id = auth_user_company_id());

-- ── invoices ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_read_own_invoices" ON invoices;
CREATE POLICY "authenticated_read_own_invoices"
  ON invoices FOR SELECT TO authenticated
  USING (company_id = auth_user_company_id());

-- ── setup_payments ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "authenticated_read_own_setup_payments" ON setup_payments;
CREATE POLICY "authenticated_read_own_setup_payments"
  ON setup_payments FOR SELECT TO authenticated
  USING (company_id = auth_user_company_id());

-- ── pagarme_webhook_events ────────────────────────────────────────────────────
-- Apenas service_role (sem dados sensíveis de negócio para expor ao usuário)
DROP POLICY IF EXISTS "service_role_webhook_events_all" ON pagarme_webhook_events;
CREATE POLICY "service_role_webhook_events_all"
  ON pagarme_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);
