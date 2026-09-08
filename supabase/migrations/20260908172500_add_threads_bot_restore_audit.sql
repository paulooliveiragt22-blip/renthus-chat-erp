-- -----------------------------------------------------------------------------
-- Auditoria da restauração automática do chatbot após HITL "enviar resumo".
--
-- Quando o cliente resolve (confirmar / cancelar / expirar / falhar) uma
-- confirmação de pedido montada por atendente humano via WhatsApp Inbox,
-- o pipeline `resolvePendingOrderConfirmation` agora reativa automaticamente
-- `bot_active = true` (bot volta a atender, não fica preso no modo "Humano").
-- Estas colunas armazenam quando e por qual motivo o bot foi restaurado,
-- para auditoria e debug.
--
-- Operação segura (Postgres 12+): colunas NULLABLE SEM DEFAULT = SEM rewrite
-- de tabela grande, SEM lock exclusivo longo, SEM downtime. Idempotente
-- via IF NOT EXISTS — rodar múltiplas vezes não causa erro.
-- -----------------------------------------------------------------------------

ALTER TABLE public.whatsapp_threads
    ADD COLUMN IF NOT EXISTS last_bot_restored_at    timestamptz,
    ADD COLUMN IF NOT EXISTS last_bot_restore_reason text;

COMMENT ON COLUMN public.whatsapp_threads.last_bot_restored_at IS
    'Última vez que o bot foi reativado automaticamente após handover (ex.: cliente resolveu confirmação de pedido HITL)';

COMMENT ON COLUMN public.whatsapp_threads.last_bot_restore_reason IS
    'Motivo da última restauração automática do bot: confirmation_resolved_confirmed | confirmation_resolved_cancelled | confirmation_resolved_expired | confirmation_resolved_failed_order';
