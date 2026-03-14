-- ============================================================
-- MIGRATION: Backfill order_items.company_id + NOT NULL
-- ============================================================
-- order_items.company_id é nullable mas todos os itens têm order_id
-- que já tem company_id. Necessário para RLS funcionar corretamente.

-- 1. Backfill company_id a partir da order pai
UPDATE public.order_items oi
SET company_id = o.company_id
FROM public.orders o
WHERE oi.order_id = o.id
  AND oi.company_id IS NULL;

-- 2. Tornar NOT NULL (após backfill todos devem ter valor)
DO $$
BEGIN
  -- Só adiciona NOT NULL se não houver NULLs restantes
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE company_id IS NULL) THEN
    ALTER TABLE public.order_items ALTER COLUMN company_id SET NOT NULL;
    RAISE NOTICE 'company_id agora é NOT NULL em order_items';
  ELSE
    RAISE WARNING 'Ainda existem order_items sem company_id — NOT NULL não aplicado';
  END IF;
END $$;

-- 3. Trigger para auto-preencher company_id em novos itens
CREATE OR REPLACE FUNCTION public.order_items_set_company_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM public.orders
    WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_items_set_company_id ON public.order_items;
CREATE TRIGGER trg_order_items_set_company_id
  BEFORE INSERT ON public.order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.order_items_set_company_id();
