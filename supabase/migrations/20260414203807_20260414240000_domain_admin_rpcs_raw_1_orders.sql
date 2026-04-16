-- Fragmento de 20260414240000_domain_admin_rpcs.sql alinhado ao registo remoto em supabase_migrations (split MCP).

-- RPCs de domínio (admin/service_role): pedidos, clientes+endereço, financeiro, caixa, entregadores, PDV.
-- Alinhadas ao comportamento das rotas Next existentes (transação onde aplicável).

-- ─── Pedidos ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_admin_cancel_order(
    p_company_id uuid,
    p_order_id uuid,
    p_reject_confirmation boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now timestamptz := now();
BEGIN
    UPDATE public.orders
    SET
        status = 'canceled',
        confirmation_status = CASE
            WHEN p_reject_confirmation THEN 'rejected'::text
            ELSE confirmation_status
        END,
        confirmed_at = CASE
            WHEN p_reject_confirmation THEN v_now
            ELSE confirmed_at
        END
    WHERE id = p_order_id
      AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_assign_driver(
    p_company_id uuid,
    p_order_id uuid,
    p_driver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_driver_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.drivers d
            WHERE d.id = p_driver_id AND d.company_id = p_company_id
        ) THEN
            RAISE EXCEPTION 'driver_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    UPDATE public.orders
    SET driver_id = p_driver_id
    WHERE id = p_order_id
      AND company_id = p_company_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;
