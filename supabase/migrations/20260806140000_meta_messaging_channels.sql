-- P0e: conexão Meta Page + Instagram/Messenger + fila/threads omnichannel.

-- ─── Conexão Page (token + page_id / ig_user_id) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_messaging_channels (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                  uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    page_id                     text NOT NULL,
    page_name                   text,
    ig_user_id                  text,
    encrypted_page_access_token text,
    status                      text NOT NULL DEFAULT 'active'
        CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'error'::text])),
    messenger_enabled           boolean NOT NULL DEFAULT true,
    instagram_enabled           boolean NOT NULL DEFAULT true,
    provider_metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meta_messaging_channels_company_uq UNIQUE (company_id),
    CONSTRAINT meta_messaging_channels_page_uq UNIQUE (page_id)
);

CREATE INDEX IF NOT EXISTS meta_messaging_channels_ig_user_idx
    ON public.meta_messaging_channels (ig_user_id)
    WHERE ig_user_id IS NOT NULL;

COMMENT ON TABLE public.meta_messaging_channels IS
    'Conexão Facebook Page + Instagram Messaging (token de página cifrado).';

ALTER TABLE public.meta_messaging_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_messaging_channels_select_company ON public.meta_messaging_channels;
CREATE POLICY meta_messaging_channels_select_company
    ON public.meta_messaging_channels
    FOR SELECT
    TO authenticated
    USING (
        company_id IN (
            SELECT cu.company_id
            FROM public.company_users cu
            WHERE cu.user_id = auth.uid()
        )
    );

GRANT SELECT ON public.meta_messaging_channels TO authenticated;
GRANT ALL ON public.meta_messaging_channels TO service_role;

-- ─── Threads: phone opcional (IG/Messenger usam channel+external_id) ─────────
ALTER TABLE public.whatsapp_threads
    ALTER COLUMN phone_e164 DROP NOT NULL;

-- Unique legado (company, phone) só quando phone preenchido
DROP INDEX IF EXISTS public.whatsapp_threads_company_phone_unique;
DROP INDEX IF EXISTS public.whatsapp_threads_company_phone_uq;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_threads_company_phone_uq
    ON public.whatsapp_threads (company_id, phone_e164)
    WHERE phone_e164 IS NOT NULL;

-- ─── Fila: canal + user id (PSID/IGSID) ──────────────────────────────────────
ALTER TABLE public.chatbot_queue
    ADD COLUMN IF NOT EXISTS messaging_channel text NOT NULL DEFAULT 'whatsapp';

ALTER TABLE public.chatbot_queue
    ADD COLUMN IF NOT EXISTS channel_user_id text;

ALTER TABLE public.chatbot_queue
    DROP CONSTRAINT IF EXISTS chatbot_queue_messaging_channel_check;

ALTER TABLE public.chatbot_queue
    ADD CONSTRAINT chatbot_queue_messaging_channel_check
    CHECK (
        messaging_channel = ANY (ARRAY[
            'whatsapp'::text,
            'instagram'::text,
            'messenger'::text
        ])
    );

ALTER TABLE public.chatbot_queue
    ALTER COLUMN phone_e164 DROP NOT NULL;

COMMENT ON COLUMN public.chatbot_queue.messaging_channel IS
    'Canal do job: whatsapp | instagram | messenger';
COMMENT ON COLUMN public.chatbot_queue.channel_user_id IS
    'PSID/IGSID/E.164 do usuário no canal (espelha threads.external_id)';
