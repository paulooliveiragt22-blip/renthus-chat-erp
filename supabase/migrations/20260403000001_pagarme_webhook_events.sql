-- Idempotência de webhooks Pagar.me (evita reprocessar o mesmo event.id em retries bem-sucedidos)

CREATE TABLE IF NOT EXISTS public.pagarme_webhook_events (
    id text PRIMARY KEY,
    event_type text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pagarme_webhook_events_received_at_idx
    ON public.pagarme_webhook_events (received_at DESC);

COMMENT ON TABLE public.pagarme_webhook_events IS
    'IDs de eventos Pagar.me já processados; inserção antes do handler evita efeito duplicado.';

ALTER TABLE public.pagarme_webhook_events ENABLE ROW LEVEL SECURITY;
