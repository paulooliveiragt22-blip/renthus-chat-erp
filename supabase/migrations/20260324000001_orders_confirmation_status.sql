-- ─── Fila de Confirmação: adiciona confirmation_status em orders ──────────────
-- Pedidos via chatbot chegam como 'pending_confirmation'.
-- O atendente confirma/rejeita no dashboard → Agent Electron imprime ao confirmar.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'pending_confirmation';

-- Index para a query da fila (company + status + criação)
CREATE INDEX IF NOT EXISTS idx_orders_confirmation_status
  ON public.orders(company_id, confirmation_status, created_at);

-- Pedidos existentes (inseridos antes da migration) já estão processados:
-- marcamos como 'confirmed' para não aparecerem na fila.
UPDATE public.orders
  SET confirmation_status = 'confirmed'
  WHERE confirmation_status = 'pending_confirmation'
    AND status IN ('new', 'delivered', 'finalized', 'canceled');
