-- ============================================================
-- MIGRATION: Fix crítico — indexes duplicados + constraints
-- ============================================================

-- 1. Drop duplicate unique index em company_users
--    (company_users_company_id_user_id_key e company_users_company_user_unique são idênticos)
DROP INDEX IF EXISTS public.company_users_company_user_unique;

-- 2. Drop duplicate unique index em whatsapp_threads
--    (whatsapp_threads_company_phone_unique e whatsapp_threads_company_phone_uq são idênticos)
DROP INDEX IF EXISTS public.whatsapp_threads_company_phone_unique;

-- 3. Fix misleading index name em whatsapp_messages
--    (whatsapp_messages_company_idx indexa (provider, created_at), não company_id)
DROP INDEX IF EXISTS public.whatsapp_messages_company_idx;
CREATE INDEX IF NOT EXISTS whatsapp_messages_provider_created_idx
  ON public.whatsapp_messages(provider, created_at);

-- 4. Prevent multiple active subscriptions per company
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_active_company_uq
  ON public.subscriptions(company_id) WHERE status = 'active';

-- 5. Fix product with empty name (1 registro)
UPDATE public.products SET name = 'Produto sem nome' WHERE name = '';

-- Add CHECK to prevent future empty names
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_name_not_empty;
ALTER TABLE public.products
  ADD CONSTRAINT products_name_not_empty CHECK (name <> '');
