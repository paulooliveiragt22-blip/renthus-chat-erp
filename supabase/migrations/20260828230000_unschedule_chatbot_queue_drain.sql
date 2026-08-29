-- ADR-0003 Fase 4: remove pg_cron drain de fila (substituído por SQS + Lambda).
-- Idempotente: só desagenda se o job existir.

DO $$
DECLARE
  jid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR jid IN
      SELECT jobid FROM cron.job WHERE jobname = 'chatbot-queue-drain'
    LOOP
      PERFORM cron.unschedule(jid);
    END LOOP;
  END IF;
END $$;
