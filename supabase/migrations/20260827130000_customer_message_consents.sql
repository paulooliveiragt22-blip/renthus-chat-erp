-- T1: consentimento marketing WhatsApp (opt-in / opt-out).
-- + last_health_* em meta_messaging_channels (C2).

ALTER TABLE public.meta_messaging_channels
  ADD COLUMN IF NOT EXISTS last_health_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_health_ok boolean,
  ADD COLUMN IF NOT EXISTS last_health_error text;

CREATE TABLE IF NOT EXISTS public.customer_message_consents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  channel            text NOT NULL DEFAULT 'whatsapp',
  marketing_opt_in   boolean NOT NULL DEFAULT false,
  opt_in_at          timestamptz,
  opt_out_at         timestamptz,
  source             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_message_consents_channel_check
    CHECK (channel = ANY (ARRAY['whatsapp'::text])),
  CONSTRAINT customer_message_consents_company_customer_channel_uq
    UNIQUE (company_id, customer_id, channel)
);

CREATE INDEX IF NOT EXISTS customer_message_consents_company_idx
  ON public.customer_message_consents (company_id);

CREATE INDEX IF NOT EXISTS customer_message_consents_customer_idx
  ON public.customer_message_consents (customer_id);

COMMENT ON TABLE public.customer_message_consents IS
  'Opt-in/out marketing por canal. MARKETING HSM/campanha exige marketing_opt_in=true.';

ALTER TABLE public.customer_message_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_message_consents FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_message_consents FROM anon;
REVOKE ALL ON TABLE public.customer_message_consents FROM authenticated;

DROP POLICY IF EXISTS rls_customer_message_consents_service_role_only
  ON public.customer_message_consents;

CREATE POLICY rls_customer_message_consents_service_role_only
  ON public.customer_message_consents
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.customer_message_consents TO service_role;
