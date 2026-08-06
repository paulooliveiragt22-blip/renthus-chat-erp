-- Threads omnichannel: channel + external_id (WA=phone, IG=IGSID, Messenger=PSID).
-- phone_e164 permanece para WhatsApp (nullable no futuro se necessário; hoje NOT NULL).

ALTER TABLE public.whatsapp_threads
    ADD COLUMN IF NOT EXISTS channel text;

ALTER TABLE public.whatsapp_threads
    ADD COLUMN IF NOT EXISTS external_id text;

-- Backfill WhatsApp
UPDATE public.whatsapp_threads
SET
    channel = COALESCE(channel, 'whatsapp'),
    external_id = COALESCE(NULLIF(btrim(external_id), ''), NULLIF(btrim(phone_e164), ''))
WHERE channel IS NULL OR external_id IS NULL;

ALTER TABLE public.whatsapp_threads
    DROP CONSTRAINT IF EXISTS whatsapp_threads_channel_check;

ALTER TABLE public.whatsapp_threads
    ADD CONSTRAINT whatsapp_threads_channel_check
    CHECK (
        channel IS NULL
        OR channel = ANY (ARRAY[
            'whatsapp'::text,
            'instagram'::text,
            'messenger'::text
        ])
    );

-- Lookup por identidade de canal (empresa + canal + external_id)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_threads_company_channel_external_uq
    ON public.whatsapp_threads (company_id, channel, external_id)
    WHERE channel IS NOT NULL AND external_id IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_threads.channel IS
    'Canal Meta: whatsapp | instagram | messenger';
COMMENT ON COLUMN public.whatsapp_threads.external_id IS
    'ID do usuário no canal (E.164 no WA, IGSID no IG, PSID no Messenger)';
