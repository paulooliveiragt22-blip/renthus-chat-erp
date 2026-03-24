-- Vínculo do pedido ao endereço cadastrado do cliente (enderecos_cliente).
-- delivery_address (text) permanece como snapshot legível para impressão/histórico.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_endereco_cliente_id uuid
  REFERENCES public.enderecos_cliente (id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_endereco_cliente_id
  ON public.orders (delivery_endereco_cliente_id)
  WHERE delivery_endereco_cliente_id IS NOT NULL;

COMMENT ON COLUMN public.orders.delivery_endereco_cliente_id IS
  'FK para enderecos_cliente usado neste pedido; texto em delivery_address pode divergir se o cadastro for editado depois.';
