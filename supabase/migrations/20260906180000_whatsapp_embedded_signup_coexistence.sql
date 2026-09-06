-- Embedded Signup + Coexistence (ADR-0010 / C6).
-- Coluna is_on_biz_app; comment de provisioning_mode deixa de ser “futuro”.

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS is_on_biz_app boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_channels.provisioning_mode IS
  'platform | tenant_paste | embedded_signup';

COMMENT ON COLUMN public.whatsapp_channels.is_on_biz_app IS
  'Coexistence: número ainda no WhatsApp Business app (Graph is_on_biz_app)';
