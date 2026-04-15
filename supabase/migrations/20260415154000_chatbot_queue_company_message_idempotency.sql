-- Idempotência da fila por tenant:
-- substitui o unique legado em message_id isolado por unique parcial em
-- (company_id, message_id), permitindo replay seguro multi-tenant.

CREATE UNIQUE INDEX IF NOT EXISTS chatbot_queue_company_message_id_uidx
    ON public.chatbot_queue (company_id, message_id)
    WHERE message_id IS NOT NULL;

DROP INDEX IF EXISTS public.chatbot_queue_message_id_idx;
