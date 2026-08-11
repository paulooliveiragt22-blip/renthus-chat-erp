-- Confirmação de pedido montado pelo atendente durante atendimento humano.
--
-- Fluxo: atendente monta/edita o carrinho no WhatsApp Inbox (itens, endereço,
-- pagamento) e clica "Enviar para confirmação". Isso grava um rascunho aqui
-- (status 'pending') e manda uma mensagem determinística (sem IA) pro cliente
-- pedindo CONFIRMAR/CANCELAR. Um interceptor em process-queue (independente do
-- bot estar ativo) detecta a resposta e só então cria o pedido de verdade via
-- OrderServiceV2Adapter.createFromDraft (mesma RPC/validação que o bot usa).
--
-- Não é acessada diretamente do browser (RLS habilitado, sem policies —
-- só service_role via APIs server-side, mesmo padrão de abandoned_carts).

CREATE TABLE IF NOT EXISTS whatsapp_order_confirmations (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   uuid        NOT NULL,
    thread_id    uuid        NOT NULL,
    customer_id  uuid,
    draft        jsonb       NOT NULL,
    summary_text text        NOT NULL,
    status       text        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'confirmed', 'cancelled', 'expired', 'failed')),
    created_by   uuid,
    order_id     uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);

-- No máximo 1 confirmação em aberto por thread — evita o atendente empilhar
-- pedidos concorrentes pro mesmo cliente.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_order_confirmations_open_thread_idx
    ON whatsapp_order_confirmations (thread_id)
    WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS whatsapp_order_confirmations_company_idx
    ON whatsapp_order_confirmations (company_id, status, created_at DESC);

ALTER TABLE whatsapp_order_confirmations ENABLE ROW LEVEL SECURITY;
