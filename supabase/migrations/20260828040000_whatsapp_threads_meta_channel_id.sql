-- IG/Messenger: channel_id guarda meta_messaging_channels.id (não whatsapp_channels).
-- WhatsApp continua usando whatsapp_channels.id na aplicação.

ALTER TABLE public.whatsapp_threads
    DROP CONSTRAINT IF EXISTS whatsapp_threads_channel_id_fkey;

ALTER TABLE public.whatsapp_threads
    ALTER COLUMN channel_id DROP NOT NULL;

COMMENT ON COLUMN public.whatsapp_threads.channel_id IS
    'whatsapp → whatsapp_channels.id; instagram/messenger → meta_messaging_channels.id';
