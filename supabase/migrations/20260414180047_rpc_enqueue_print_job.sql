-- RPC transacional para enfileirar impressão com resolução server-side da impressora.
-- Aplicado via MCP Supabase (apply_migration); versão alinhada ao remoto.

CREATE OR REPLACE FUNCTION public.rpc_enqueue_print_job(
    p_company_id uuid,
    p_order_id uuid,
    p_source text DEFAULT 'reprint',
    p_change numeric DEFAULT 0,
    p_priority integer DEFAULT 5
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job_id uuid;
    v_printer_id uuid;
BEGIN
    SELECT cp.printer_id
      INTO v_printer_id
      FROM public.company_printers cp
     WHERE cp.company_id = p_company_id
       AND cp.is_default = true
     LIMIT 1;

    IF v_printer_id IS NULL THEN
        SELECT p.id
          INTO v_printer_id
          FROM public.printers p
         WHERE p.company_id = p_company_id
           AND p.is_active = true
         ORDER BY p.created_at ASC
         LIMIT 1;
    END IF;

    IF v_printer_id IS NULL THEN
        RAISE EXCEPTION 'Nenhuma impressora ativa configurada para esta empresa';
    END IF;

    INSERT INTO public.print_jobs (
        company_id,
        order_id,
        source_id,
        printer_id,
        payload,
        status,
        attempts,
        priority,
        source
    ) VALUES (
        p_company_id,
        p_order_id,
        p_order_id,
        v_printer_id,
        jsonb_build_object('type', 'receipt', 'orderId', p_order_id, 'change', COALESCE(p_change, 0)),
        'pending',
        0,
        COALESCE(p_priority, 5),
        COALESCE(NULLIF(trim(p_source), ''), 'reprint')
    )
    RETURNING id INTO v_job_id;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_enqueue_print_job(uuid, uuid, text, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_enqueue_print_job(uuid, uuid, text, numeric, integer) TO service_role;
