-- T2: campanhas WhatsApp (massa) + purpose outbound_jobs.broadcast_template

ALTER TABLE public.outbound_jobs
  DROP CONSTRAINT IF EXISTS outbound_jobs_purpose_check;

ALTER TABLE public.outbound_jobs
  ADD CONSTRAINT outbound_jobs_purpose_check
  CHECK (
    purpose = ANY (
      ARRAY[
        'cart_recovery'::text,
        'reengagement'::text,
        'promo'::text,
        'transactional'::text,
        'broadcast_template'::text
      ]
    )
  );

CREATE TABLE IF NOT EXISTS public.broadcast_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  template_id           uuid NOT NULL REFERENCES public.whatsapp_message_templates (id) ON DELETE RESTRICT,
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY[
      'draft'::text,
      'running'::text,
      'paused'::text,
      'done'::text,
      'cancelled'::text
    ])),
  audience_filter       jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_body_params  jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_recipients      integer NOT NULL DEFAULT 0,
  sent_count            integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  skipped_count         integer NOT NULL DEFAULT 0,
  created_by            uuid,
  started_at            timestamptz,
  finished_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broadcast_campaigns_company_idx
  ON public.broadcast_campaigns (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.broadcast_campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.broadcast_campaigns (id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  phone_e164      text NOT NULL,
  thread_id       uuid,
  outbound_job_id uuid,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY[
      'pending'::text,
      'queued'::text,
      'sent'::text,
      'failed'::text,
      'skipped'::text,
      'cancelled'::text
    ])),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT broadcast_campaign_recipients_campaign_phone_uq
    UNIQUE (campaign_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS broadcast_campaign_recipients_campaign_idx
  ON public.broadcast_campaign_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS broadcast_campaign_recipients_company_idx
  ON public.broadcast_campaign_recipients (company_id);

COMMENT ON TABLE public.broadcast_campaigns IS
  'Campanhas de template WhatsApp (massa). MARKETING exige opt-in.';
COMMENT ON TABLE public.broadcast_campaign_recipients IS
  'Destinatários por campanha; outbound_job_id liga à fila.';

ALTER TABLE public.broadcast_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_campaign_recipients FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.broadcast_campaigns FROM anon;
REVOKE ALL ON TABLE public.broadcast_campaigns FROM authenticated;
REVOKE ALL ON TABLE public.broadcast_campaign_recipients FROM anon;
REVOKE ALL ON TABLE public.broadcast_campaign_recipients FROM authenticated;

DROP POLICY IF EXISTS rls_broadcast_campaigns_service_role_only ON public.broadcast_campaigns;
CREATE POLICY rls_broadcast_campaigns_service_role_only
  ON public.broadcast_campaigns
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS rls_broadcast_campaign_recipients_service_role_only
  ON public.broadcast_campaign_recipients;
CREATE POLICY rls_broadcast_campaign_recipients_service_role_only
  ON public.broadcast_campaign_recipients
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.broadcast_campaigns TO service_role;
GRANT ALL ON TABLE public.broadcast_campaign_recipients TO service_role;
