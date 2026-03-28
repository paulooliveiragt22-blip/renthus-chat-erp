-- ============================================================
-- Fix: enqueue_print_job_for_order
--
-- Problemas corrigidos:
-- 1. Trigger só disparava em INSERT com status='new' — não cobria
--    pedidos PDV (status='finalized') nem confirmações tardias
--    (UPDATE de confirmation_status → 'confirmed').
-- 2. Agora dispara em INSERT (qualquer status) ou UPDATE quando
--    confirmation_status muda para 'confirmed'.
-- ============================================================

-- Atualiza a função para aceitar INSERT e UPDATE
CREATE OR REPLACE FUNCTION public.enqueue_print_job_for_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_printer_id     uuid;
  v_printer_format text;
  v_payload        jsonb;
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;

  -- Só processa pedidos confirmados
  IF COALESCE(NEW.confirmation_status, '') <> 'confirmed' THEN RETURN NEW; END IF;

  -- Em UPDATE: só dispara se confirmation_status acabou de mudar para 'confirmed'
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.confirmation_status, '') = 'confirmed' THEN RETURN NEW; END IF;
  END IF;

  -- Não reimprimir pedido já impresso
  IF NEW.printed_at IS NOT NULL THEN RETURN NEW; END IF;

  -- Evita job duplicado
  IF EXISTS (
    SELECT 1 FROM public.print_jobs
    WHERE source = 'order' AND source_id = NEW.id
      AND status IN ('pending', 'processing')
  ) THEN
    RETURN NEW;
  END IF;

  -- Resolve impressora: padrão da empresa → auto_print
  SELECT p.id, p.format
  INTO v_printer_id, v_printer_format
  FROM public.company_printers cp
  JOIN public.printers p ON p.id = cp.printer_id
  WHERE cp.company_id = NEW.company_id
    AND COALESCE(cp.is_default, false) = true
    AND COALESCE(p.is_active, true) = true
  LIMIT 1;

  IF v_printer_id IS NULL THEN
    SELECT p.id, p.format
    INTO v_printer_id, v_printer_format
    FROM public.printers p
    WHERE p.company_id = NEW.company_id
      AND COALESCE(p.auto_print, false) = true
      AND COALESCE(p.is_active, true) = true
    ORDER BY p.created_at LIMIT 1;
  END IF;

  IF v_printer_id IS NULL THEN RETURN NEW; END IF;

  v_payload := jsonb_build_object(
    'type',    COALESCE(v_printer_format, 'receipt'),
    'orderId', NEW.id::text
  );

  INSERT INTO public.print_jobs (
    company_id, source, source_id, printer_id,
    payload, status, priority, max_attempts, created_at
  ) VALUES (
    NEW.company_id, 'order', NEW.id, v_printer_id,
    v_payload, 'pending', 100, 5, now()
  );

  RETURN NEW;
END;
$$;

-- Recria o trigger para aceitar INSERT e UPDATE
DROP TRIGGER IF EXISTS trg_enqueue_print_job_after_order_insert ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_print_job_after_order_update ON public.orders;

CREATE TRIGGER trg_enqueue_print_job_after_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW
WHEN (NEW.company_id IS NOT NULL)
EXECUTE FUNCTION public.enqueue_print_job_for_order();

CREATE TRIGGER trg_enqueue_print_job_after_order_update
AFTER UPDATE OF confirmation_status ON public.orders
FOR EACH ROW
WHEN (NEW.company_id IS NOT NULL)
EXECUTE FUNCTION public.enqueue_print_job_for_order();
