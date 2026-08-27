-- Canais tenant + Templates WhatsApp M0 (App Review Tech Provider).
-- Harden whatsapp_channels → service_role_only; colunas provisioning/health;
-- audit actor_kind; mirror message_templates; feature Pro+Market.

-- ─── whatsapp_channels: colunas ──────────────────────────────────────────────
ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS provisioning_mode text NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS credential_source text,
  ADD COLUMN IF NOT EXISTS last_health_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_health_ok boolean,
  ADD COLUMN IF NOT EXISTS last_health_error text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_channels_provisioning_mode_check'
  ) THEN
    ALTER TABLE public.whatsapp_channels
      ADD CONSTRAINT whatsapp_channels_provisioning_mode_check
      CHECK (provisioning_mode = ANY (ARRAY[
        'platform'::text,
        'tenant_paste'::text,
        'embedded_signup'::text
      ]));
  END IF;
END $$;

UPDATE public.whatsapp_channels
SET provisioning_mode = 'platform'
WHERE provisioning_mode IS NULL OR provisioning_mode = '';

COMMENT ON COLUMN public.whatsapp_channels.provisioning_mode IS
  'platform | tenant_paste | embedded_signup (futuro)';
COMMENT ON COLUMN public.whatsapp_channels.credential_source IS
  'Ultimo writer: platform_user | company_user';

-- ─── Harden RLS whatsapp_channels ────────────────────────────────────────────
REVOKE ALL ON TABLE public.whatsapp_channels FROM anon;
REVOKE ALL ON TABLE public.whatsapp_channels FROM authenticated;

ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_channels FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_channels'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_channels', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY rls_whatsapp_channels_service_role_only
  ON public.whatsapp_channels
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.whatsapp_channels TO service_role;

-- ─── Audit: actor_kind / actor_user_id ───────────────────────────────────────
ALTER TABLE public.whatsapp_channel_credential_audit
  ADD COLUMN IF NOT EXISTS actor_kind text,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid;

UPDATE public.whatsapp_channel_credential_audit
SET actor_kind = CASE
  WHEN actor LIKE 'platform:%' THEN 'platform'
  ELSE COALESCE(actor_kind, 'company_user')
END
WHERE actor_kind IS NULL;

ALTER TABLE public.whatsapp_channel_credential_audit
  ALTER COLUMN actor_kind SET DEFAULT 'platform';

ALTER TABLE public.whatsapp_channel_credential_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_channel_credential_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_channel_credential_audit FROM anon;
REVOKE ALL ON TABLE public.whatsapp_channel_credential_audit FROM authenticated;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_channel_credential_audit'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.whatsapp_channel_credential_audit',
      pol.policyname
    );
  END LOOP;
END $$;

CREATE POLICY rls_whatsapp_channel_credential_audit_service_role_only
  ON public.whatsapp_channel_credential_audit
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.whatsapp_channel_credential_audit TO service_role;

-- ─── whatsapp_message_templates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_message_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  waba_id           text NOT NULL,
  meta_template_id  text,
  name              text NOT NULL,
  language          text NOT NULL DEFAULT 'pt_BR',
  category          text NOT NULL DEFAULT 'UTILITY',
  status            text NOT NULL DEFAULT 'PENDING',
  components        jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason  text,
  last_synced_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_message_templates_category_check
    CHECK (category = ANY (ARRAY[
      'UTILITY'::text,
      'MARKETING'::text,
      'AUTHENTICATION'::text
    ])),
  CONSTRAINT whatsapp_message_templates_status_check
    CHECK (status = ANY (ARRAY[
      'PENDING'::text,
      'APPROVED'::text,
      'REJECTED'::text,
      'PAUSED'::text,
      'DISABLED'::text,
      'IN_APPEAL'::text
    ])),
  CONSTRAINT whatsapp_message_templates_company_name_lang_uq
    UNIQUE (company_id, name, language)
);

CREATE INDEX IF NOT EXISTS whatsapp_message_templates_company_idx
  ON public.whatsapp_message_templates (company_id);

CREATE INDEX IF NOT EXISTS whatsapp_message_templates_waba_idx
  ON public.whatsapp_message_templates (waba_id);

COMMENT ON TABLE public.whatsapp_message_templates IS
  'Espelho de message templates Meta (HSM) por empresa; fonte da verdade = Graph/Manager.';

ALTER TABLE public.whatsapp_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_templates FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_message_templates FROM anon;
REVOKE ALL ON TABLE public.whatsapp_message_templates FROM authenticated;

DROP POLICY IF EXISTS rls_whatsapp_message_templates_service_role_only
  ON public.whatsapp_message_templates;

CREATE POLICY rls_whatsapp_message_templates_service_role_only
  ON public.whatsapp_message_templates
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON TABLE public.whatsapp_message_templates TO service_role;

-- ─── Feature Pro + Market ────────────────────────────────────────────────────
INSERT INTO public.features (key, description)
VALUES (
  'whatsapp_templates_broadcast',
  'Templates WhatsApp (HSM) + envio 1:1; campanhas em massa nas fases T1/T2'
)
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO public.plan_features (plan_id, feature_key)
SELECT p.id, 'whatsapp_templates_broadcast'
FROM public.plans p
WHERE p.key IN ('pro', 'market')
ON CONFLICT DO NOTHING;
