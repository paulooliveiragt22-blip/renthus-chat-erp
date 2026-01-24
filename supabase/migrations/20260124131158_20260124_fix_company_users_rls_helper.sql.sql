-- 20260124_fix_company_users_rls_helper.sql
BEGIN;

-- 1) Função helper: verifica se o JWT.user_id atual é owner/admin da company
CREATE OR REPLACE FUNCTION public.renthus_is_company_admin_for_session(p_company uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- pega claim user_id de forma segura (retorna false se não existir)
  BEGIN
    v_user_id := current_setting('jwt.claims.user_id', true)::uuid;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;

  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.company_users cu
    WHERE cu.company_id = p_company
      AND cu.user_id = v_user_id
      AND cu.role = ANY (ARRAY['owner'::text, 'admin'::text])
      AND COALESCE(cu.is_active, true)
  );
END;
$$;

-- 2) Garante que a função seja owned by postgres (para BYPASSRLS)
--    Se no seu ambiente o role for outro, substitua 'postgres' pelo role correto.
ALTER FUNCTION public.renthus_is_company_admin_for_session(uuid) OWNER TO postgres;

COMMIT;
