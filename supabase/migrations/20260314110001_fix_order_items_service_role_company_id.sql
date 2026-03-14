-- ============================================================
-- HOTFIX: Corrigir set_company_id_from_auth para auto-preencher
-- company_id em order_items quando chamado via service_role (bot)
-- ============================================================
-- Problema: migration 100006 fez company_id NOT NULL em order_items,
-- mas o bot (service_role) não passa company_id nos itens.
-- O trigger anterior lançava EXCEPTION para service_role + company_id NULL,
-- causando falha silenciosa em todos os inserts de itens.
-- Resultado: pedidos criados sem itens (fantasmas).
--
-- Fix: auto-preencher company_id a partir do orders.company_id quando null.

CREATE OR REPLACE FUNCTION public.set_company_id_from_auth()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_company_id uuid;
BEGIN
  IF auth.role() = 'service_role' THEN
    -- Auto-fill company_id a partir do pedido pai (bot não passa company_id nos itens)
    IF NEW.company_id IS NULL AND NEW.order_id IS NOT NULL THEN
      SELECT company_id INTO NEW.company_id
      FROM public.orders WHERE id = NEW.order_id;
    END IF;
    -- Após tentativa de fill, ainda NULL = erro real
    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION 'company_id obrigatório para inserts via service_role em order_items (order_id=%)', NEW.order_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Usuário autenticado: auto-preenche company_id pelo JWT
  IF NEW.company_id IS NULL THEN
    SELECT cu.company_id INTO v_company_id
    FROM public.company_users cu
    WHERE cu.user_id = auth.uid() AND cu.is_active = true
    ORDER BY cu.created_at ASC LIMIT 1;
    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'No active company for user %', auth.uid();
    END IF;
    NEW.company_id := v_company_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Cancelar pedidos fantasma gerados pelo bug (total > 0 mas sem itens)
UPDATE public.orders
SET status = 'canceled'
WHERE id IN (
  '71545b27-1d76-402e-b58d-62a8de97e8e2',
  'b0b218ed-5bea-4360-a9b6-1d52afb2c47d',
  'cd132fa8-bea4-42c8-a53f-88b82b192a88'
)
AND status = 'new';
