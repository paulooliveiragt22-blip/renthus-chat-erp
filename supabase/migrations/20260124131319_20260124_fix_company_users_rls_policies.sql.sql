-- 20260124_fix_company_users_rls_policies.sql
BEGIN;

-- 1) Policy: usuário vê a própria linha (idempotente)
DROP POLICY IF EXISTS company_users_select_self ON public.company_users;
CREATE POLICY company_users_select_self
  ON public.company_users
  FOR SELECT
  USING (
    user_id = auth.uid()
  );

-- 2) Policy: permite que um admin/owner da mesma company veja as memberships
--    (Substitui a policy anterior que fazia EXISTS (...) sobre company_users cu2)
DROP POLICY IF EXISTS company_users_select ON public.company_users;
CREATE POLICY company_users_select
  ON public.company_users
  FOR SELECT
  USING (
    -- permite ver quando o claim user_id é justamente a linha (compatibilidade)
    (current_setting('jwt.claims.user_id', true))::uuid = public.company_users.user_id
    -- OU quando o claim user_id é owner/admin da mesma company
    OR public.renthus_is_company_admin_for_session(public.company_users.company_id)
  );

COMMIT;
