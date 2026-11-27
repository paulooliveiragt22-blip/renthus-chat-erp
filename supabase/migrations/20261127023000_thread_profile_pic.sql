-- Foto de perfil do cliente no inbox (Instagram / Messenger).
-- A URL da Meta expira; profile_pic_fetched_at marca a última tentativa.

alter table public.whatsapp_threads
    add column if not exists profile_pic_url text,
    add column if not exists profile_pic_fetched_at timestamptz;

comment on column public.whatsapp_threads.profile_pic_url is
    'URL https temporária da foto de perfil Meta (IG/Messenger).';
comment on column public.whatsapp_threads.profile_pic_fetched_at is
    'Última leitura bem-sucedida do perfil Meta. Evita refetch a cada poll do inbox.';
