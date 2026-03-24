-- Adiciona coluna history à tabela chatbot_sessions para windowing de contexto.
-- Armazena as últimas 8 mensagens (user/bot) para evitar acúmulo infinito de contexto.

ALTER TABLE chatbot_sessions
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;
