-- Pin search_path on public app functions missing it; drop leftover stub.
-- Does not touch extension-owned objects (pg_trgm / unaccent).

DROP FUNCTION IF EXISTS public.nome_da_sua_funcao_aqui();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    LEFT JOIN pg_extension ext ON ext.oid = d.refobjid
    WHERE n.nspname = 'public'
      AND ext.extname IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path TO public, pg_temp',
      r.sig
    );
  END LOOP;
END $$;
