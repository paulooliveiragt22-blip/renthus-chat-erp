-- Fragmento de 20260414240000_domain_admin_rpcs.sql alinhado ao registo remoto em supabase_migrations (split MCP).

-- ─── Grants (service_role apenas) ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.rpc_admin_cancel_order(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_cancel_order(uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_admin_assign_driver(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_assign_driver(uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_upsert_customer_with_primary_address(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_customer_with_primary_address(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_upsert_expense(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_expense(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_pay_bill(uuid, uuid, numeric, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_pay_bill(uuid, uuid, numeric, text, date) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_open_cash_register(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_cash_register(uuid, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_close_cash_register(uuid, uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_cash_register(uuid, uuid, numeric, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_upsert_driver(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_driver(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_toggle_driver_active(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_toggle_driver_active(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_delete_driver(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_delete_driver(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_finalize_pdv_order(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_pdv_order(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_finalize_sale(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_sale(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.rpc_finalize_pdv_order(uuid, jsonb) IS
    'Fecha venda PDV: sales, itens, pagamentos, pedido (novo ou ativo), financial_entries — transação única.';
