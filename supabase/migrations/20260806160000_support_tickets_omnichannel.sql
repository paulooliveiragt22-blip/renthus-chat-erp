-- I2: support_tickets omnichannel — phone opcional + customer_id + thread_id.

ALTER TABLE public.support_tickets
    ALTER COLUMN customer_phone DROP NOT NULL;

ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL;

ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.whatsapp_threads (id) ON DELETE SET NULL;

ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS channel text;

ALTER TABLE public.support_tickets
    DROP CONSTRAINT IF EXISTS support_tickets_channel_check;

ALTER TABLE public.support_tickets
    ADD CONSTRAINT support_tickets_channel_check
    CHECK (
        channel IS NULL
        OR channel = ANY (ARRAY[
            'whatsapp'::text,
            'instagram'::text,
            'messenger'::text,
            'web'::text,
            'admin'::text
        ])
    );

-- Dedupe: um ticket aberto por thread
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_open_thread_uq
    ON public.support_tickets (company_id, thread_id)
    WHERE thread_id IS NOT NULL AND status = ANY (ARRAY['open'::text, 'in_progress'::text]);

-- Dedupe legado por phone (só quando phone preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_open_phone_uq
    ON public.support_tickets (company_id, customer_phone)
    WHERE customer_phone IS NOT NULL AND status = ANY (ARRAY['open'::text, 'in_progress'::text]);

CREATE INDEX IF NOT EXISTS support_tickets_customer_id_idx
    ON public.support_tickets (company_id, customer_id)
    WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.support_tickets.customer_phone IS
    'E.164 opcional (IG/Messenger podem criar ticket sem phone)';
COMMENT ON COLUMN public.support_tickets.customer_id IS
    'Cliente resolvido por identidade de canal quando disponível';
COMMENT ON COLUMN public.support_tickets.thread_id IS
    'Thread de origem do handover (dedupe omnichannel)';
