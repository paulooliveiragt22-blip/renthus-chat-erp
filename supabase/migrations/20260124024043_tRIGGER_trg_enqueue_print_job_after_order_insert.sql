
-- 1) Função: enfileira print_job ao inserir um order
CREATE OR REPLACE FUNCTION public.enqueue_print_job_for_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_printer_id uuid;
  v_printer_format text;
  v_payload jsonb;
BEGIN
  -- Require company
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only enqueue for orders with status = 'new' (change if you want different rule)
  IF COALESCE(NEW.status, '') <> 'new' THEN
    RETURN NEW;
  END IF;

  -- Avoid creating duplicate job for same order if there's already pending/processing job
  IF EXISTS (
    SELECT 1 FROM public.print_jobs
    WHERE order_id = NEW.id AND status IN ('pending','processing')
  ) THEN
    RETURN NEW;
  END IF;

  -- 1) Try company_printers default (preferred)
  SELECT p.id, p.format
  INTO v_printer_id, v_printer_format
  FROM public.company_printers cp
  JOIN public.printers p ON p.id = cp.printer_id
  WHERE cp.company_id = NEW.company_id
    AND COALESCE(cp.is_default, false) = true
    AND COALESCE(p.is_active, true) = true
  LIMIT 1;

  -- 2) Fallback: printers with auto_print=true
  IF v_printer_id IS NULL THEN
    SELECT p.id, p.format
    INTO v_printer_id, v_printer_format
    FROM public.printers p
    WHERE p.company_id = NEW.company_id
      AND COALESCE(p.auto_print, false) = true
      AND COALESCE(p.is_active, true) = true
    ORDER BY p.created_at
    LIMIT 1;
  END IF;

  -- If no printer found, do nothing
  IF v_printer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Build lightweight payload (agent will fetch order and items)
  v_payload := jsonb_build_object(
    'type', COALESCE(v_printer_format, 'receipt'),
    'orderId', NEW.id::text
  );

  -- Insert print_jobs row
  INSERT INTO public.print_jobs
    (company_id, order_id, printer_id, source, source_id, payload, status, priority, max_attempts, created_at)
  VALUES
    (NEW.company_id, NEW.id, v_printer_id, 'order', NEW.id, v_payload, 'pending', 100, 5, now());

  RETURN NEW;
END;
$$;


-- 2) Trigger that calls the function after INSERT on public.orders
DROP TRIGGER IF EXISTS trg_enqueue_print_job_after_order_insert ON public.orders;
CREATE TRIGGER trg_enqueue_print_job_after_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW
WHEN (NEW.company_id IS NOT NULL)
EXECUTE FUNCTION public.enqueue_print_job_for_order();


ALTER TABLE public.orders ENABLE TRIGGER trg_enqueue_print_job_after_order_insert;
