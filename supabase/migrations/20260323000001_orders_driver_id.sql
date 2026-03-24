-- Adiciona campo driver_id na tabela orders (entregador responsável pelo pedido)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL;

-- Index para buscar pedidos por entregador
CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders(driver_id);
