-- Remove jobs pendentes de pedidos ainda não confirmados (criados pelo trigger antigo)
-- Esses jobs acumularam antes da migration 20260328000004 ser aplicada
DELETE FROM public.print_jobs
WHERE status = 'pending'
  AND source = 'order'
  AND source_id IN (
    SELECT id FROM public.orders
    WHERE COALESCE(confirmation_status, '') <> 'confirmed'
  );
