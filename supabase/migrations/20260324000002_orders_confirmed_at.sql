-- ─── Fila de Confirmação: coluna confirmed_at em orders ──────────────────────
-- Registra quando o atendente confirmou ou rejeitou o pedido no dashboard.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz NULL;
