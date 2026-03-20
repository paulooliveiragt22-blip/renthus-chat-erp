-- ═══════════════════════════════════════════════════════════════════════════════
-- Tabela parser_alerts: registra fallbacks do parser (nível 2 e 3)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS parser_alerts (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    thread_id   uuid        REFERENCES whatsapp_threads(id) ON DELETE SET NULL,
    level       integer     NOT NULL CHECK (level IN (2, 3)),
    input_text  text,
    error_hint  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índice para monitorar fallbacks por empresa ao longo do tempo
CREATE INDEX IF NOT EXISTS idx_parser_alerts_company_created
    ON parser_alerts(company_id, created_at DESC);

-- RLS: apenas service_role (backend) pode ler/escrever
ALTER TABLE parser_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON parser_alerts
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE parser_alerts IS
    'Registra mensagens onde o Claude Haiku falhou e o Regex (2) ou Modo Assistido (3) assumiu.';
