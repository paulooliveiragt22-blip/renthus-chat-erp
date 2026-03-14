-- ============================================================
-- MIGRATION: Sincronizar quantity ↔ qty em order_items
-- ============================================================
-- Problema: order_items tem dois campos para quantidade:
--   - quantity (integer, legado, lido pelo dashboard)
--   - qty (numeric, suporta frações, escrito pelo bot e pelo admin)
-- Há 1 registro divergente: quantity=2, qty=1.000
-- Solução: trigger que mantém quantity = qty::integer automaticamente

-- 1. Corrigir dados divergentes existentes
UPDATE public.order_items
SET quantity = qty::integer
WHERE quantity::numeric IS DISTINCT FROM qty;

-- 2. Criar função do trigger
CREATE OR REPLACE FUNCTION public.sync_order_item_qty()
RETURNS TRIGGER AS $$
BEGIN
  -- Sempre manter quantity = qty::integer para consistência
  IF NEW.qty IS NOT NULL THEN
    NEW.quantity := NEW.qty::integer;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Criar trigger BEFORE INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_order_items_sync_qty ON public.order_items;
CREATE TRIGGER trg_order_items_sync_qty
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_order_item_qty();

COMMENT ON COLUMN public.order_items.quantity IS 'Quantidade inteira (mantida em sync com qty via trigger). Use qty para leitura preferencial.';
COMMENT ON COLUMN public.order_items.qty IS 'Quantidade numérica (suporta frações para vendas por peso/volume). Fonte de verdade.';
