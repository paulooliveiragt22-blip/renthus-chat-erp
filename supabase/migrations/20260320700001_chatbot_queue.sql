-- chatbot_queue: fila assíncrona para processamento de mensagens inbound do chatbot.
-- O webhook insere aqui e retorna 200 ao Meta imediatamente.
-- Um cron (/api/chatbot/process-queue) processa os jobs pendentes.

CREATE TABLE IF NOT EXISTS chatbot_queue (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    timestamptz NOT NULL    DEFAULT now(),
    scheduled_at  timestamptz NOT NULL    DEFAULT now(),
    status        text        NOT NULL    DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    attempts      integer     NOT NULL    DEFAULT 0,
    last_error    text,
    company_id    uuid        NOT NULL,
    thread_id     uuid        NOT NULL,
    phone_e164    text        NOT NULL,
    message_id    text,
    body_text     text        NOT NULL,
    profile_name  text,
    metadata      jsonb                   DEFAULT '{}'::jsonb
);

-- Índice para o cron: só pega jobs pendentes, mais antigos primeiro
CREATE INDEX IF NOT EXISTS chatbot_queue_pending_idx
    ON chatbot_queue (scheduled_at ASC)
    WHERE status = 'pending';

-- Índice para evitar duplicação pelo message_id
CREATE UNIQUE INDEX IF NOT EXISTS chatbot_queue_message_id_idx
    ON chatbot_queue (message_id)
    WHERE message_id IS NOT NULL;

-- Só o service role acessa (admin client no webhook e no cron)
ALTER TABLE chatbot_queue ENABLE ROW LEVEL SECURITY;
