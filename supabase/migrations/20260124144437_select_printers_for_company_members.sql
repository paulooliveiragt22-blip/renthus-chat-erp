-- ------------- Printers: dropar policies antigas -------------
DROP POLICY IF EXISTS select_printers_for_company_members ON public.printers;
DROP POLICY IF EXISTS insert_printers_for_company_members ON public.printers;
DROP POLICY IF EXISTS update_printers_for_company_members ON public.printers;
DROP POLICY IF EXISTS delete_printers_for_company_members ON public.printers;

-- ------------- Printers: SELECT -------------
CREATE POLICY select_printers_for_company_members
  ON public.printers
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.company_id = public.printers.company_id
          AND cu.user_id = auth.uid()
          AND COALESCE(cu.is_active, true)
      )
    )
  );

-- ------------- Printers: INSERT -------------
CREATE POLICY insert_printers_for_company_members
  ON public.printers
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.company_id = company_id  -- 'company_id' refere-se à nova linha
          AND cu.user_id = auth.uid()
          AND COALESCE(cu.is_active, true)
      )
    )
  );

-- ------------- Printers: UPDATE -------------
CREATE POLICY update_printers_for_company_members
  ON public.printers
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.company_id = public.printers.company_id
          AND cu.user_id = auth.uid()
          AND COALESCE(cu.is_active, true)
      )
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.company_id = company_id
          AND cu.user_id = auth.uid()
          AND COALESCE(cu.is_active, true)
      )
    )
  );

-- ------------- Printers: DELETE -------------
CREATE POLICY delete_printers_for_company_members
  ON public.printers
  FOR DELETE
  USING (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.company_users cu
        WHERE cu.company_id = public.printers.company_id
          AND cu.user_id = auth.uid()
          AND COALESCE(cu.is_active, true)
      )
    )
  );

