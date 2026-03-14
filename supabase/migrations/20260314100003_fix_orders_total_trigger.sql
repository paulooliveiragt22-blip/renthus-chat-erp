-- ============================================================
-- MIGRATION: Garantir consistência total_amount = total + delivery_fee
-- ============================================================
-- Problema: orders tem dois campos ambíguos:
--   - total: subtotal dos itens (sem frete)
--   - total_amount: total final (com frete)
-- Solução: trigger BEFORE INSERT/UPDATE garante total_amount = total + delivery_fee

-- 1. Criar função do trigger
CREATE OR REPLACE FUNCTION public.calc_order_total_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_amount := COALESCE(NEW.total, 0) + COALESCE(NEW.delivery_fee, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Criar trigger
DROP TRIGGER IF EXISTS trg_orders_calc_total_amount ON public.orders;
CREATE TRIGGER trg_orders_calc_total_amount
  BEFORE INSERT OR UPDATE OF total, delivery_fee ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.calc_order_total_amount();

-- 3. Corrigir dados existentes
UPDATE public.orders
SET total_amount = total + delivery_fee
WHERE total_amount IS DISTINCT FROM (total + delivery_fee);

-- 4. Adicionar CHECK para garantir invariante
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_total_amount_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_total_amount_check
  CHECK (total_amount = total + delivery_fee);

COMMENT ON COLUMN public.orders.total IS 'Subtotal dos itens (sem taxa de entrega).';
COMMENT ON COLUMN public.orders.total_amount IS 'Total final = total + delivery_fee. Calculado automaticamente via trigger.';
