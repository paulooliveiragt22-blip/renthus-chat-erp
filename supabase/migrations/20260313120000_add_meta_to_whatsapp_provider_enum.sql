-- Adiciona o valor 'meta' ao enum whatsapp_provider
-- necessário para o webhook da Meta WhatsApp Cloud API
ALTER TYPE whatsapp_provider ADD VALUE IF NOT EXISTS 'meta';
