-- Providers WhatsApp
create type whatsapp_provider as enum ('twilio', '360dialog');

-- Status de canal
create type whatsapp_channel_status as enum ('active', 'inactive', 'migrated');

-- Status genérico de jobs
create type job_status as enum ('pending', 'processing', 'done', 'failed');
