-- Distingue mensagens do bot de mensagens do atendente humano
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sender_type text NOT NULL DEFAULT 'human';

-- Índice para filtrar por tipo de remetente se necessário
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sender_type
  ON public.whatsapp_messages(thread_id, sender_type, created_at);
