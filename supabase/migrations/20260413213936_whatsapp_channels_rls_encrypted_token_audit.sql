-- Credenciais Meta: coluna dedicada para token cifrado (app) + waba_id;
-- RLS para leitura por membros da empresa e escrita só owner/admin;
-- Auditoria de alterações (inserções via service_role no backend).

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS encrypted_access_token text,
  ADD COLUMN IF NOT EXISTS waba_id text;

UPDATE public.whatsapp_channels
SET waba_id = NULLIF(trim(provider_metadata->>'waba_id'), '')
WHERE waba_id IS NULL
  AND provider_metadata ? 'waba_id'
  AND NULLIF(trim(provider_metadata->>'waba_id'), '') IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_channels.encrypted_access_token IS
  'Token Meta cifrado pela aplicação (prefixo wa1:). Legado: access_token em provider_metadata.';

COMMENT ON COLUMN public.whatsapp_channels.waba_id IS
  'WhatsApp Business Account ID; preferir coluna em vez de provider_metadata.';

-- ─── Auditoria ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_channel_credential_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid NOT NULL REFERENCES public.whatsapp_channels(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action      text NOT NULL,
  actor       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_channel_credential_audit_channel_idx
  ON public.whatsapp_channel_credential_audit (channel_id, created_at DESC);

COMMENT ON TABLE public.whatsapp_channel_credential_audit IS
  'Registro de alterações em credenciais de canal WhatsApp (sem segredos).';

ALTER TABLE public.whatsapp_channel_credential_audit ENABLE ROW LEVEL SECURITY;

-- Sem policies para authenticated/anon: apenas service_role (backend) grava/consulta.

-- ─── RLS whatsapp_channels ───────────────────────────────────────────────────
ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_channels_select_member ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_select_member
  ON public.whatsapp_channels
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT cu.company_id
      FROM public.company_users cu
      WHERE cu.user_id = auth.uid()
        AND COALESCE(cu.is_active, true)
    )
  );

DROP POLICY IF EXISTS whatsapp_channels_insert_admin ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_insert_admin
  ON public.whatsapp_channels
  FOR INSERT
  TO authenticated
  WITH CHECK (public.renthus_is_company_admin_for_session(company_id));

DROP POLICY IF EXISTS whatsapp_channels_update_admin ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_update_admin
  ON public.whatsapp_channels
  FOR UPDATE
  TO authenticated
  USING (public.renthus_is_company_admin_for_session(company_id))
  WITH CHECK (public.renthus_is_company_admin_for_session(company_id));

DROP POLICY IF EXISTS whatsapp_channels_delete_admin ON public.whatsapp_channels;
CREATE POLICY whatsapp_channels_delete_admin
  ON public.whatsapp_channels
  FOR DELETE
  TO authenticated
  USING (public.renthus_is_company_admin_for_session(company_id));
