DROP POLICY IF EXISTS insert_printers_for_company_members ON public.printers;
CREATE POLICY insert_printers_for_company_members
  ON public.printers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.printers.company_id
        AND cu.user_id = auth.uid()
        AND COALESCE(cu.is_active, true)
    )
  );

DROP POLICY IF EXISTS update_printers_for_company_members ON public.printers;
CREATE POLICY update_printers_for_company_members
  ON public.printers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.printers.company_id
        AND cu.user_id = auth.uid()
        AND COALESCE(cu.is_active, true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.printers.company_id
        AND cu.user_id = auth.uid()
        AND COALESCE(cu.is_active, true)
    )
  );

DROP POLICY IF EXISTS insert_print_jobs_for_company_members ON public.print_jobs;
CREATE POLICY insert_print_jobs_for_company_members
  ON public.print_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.print_jobs.company_id
        AND cu.user_id = auth.uid()
        AND COALESCE(cu.is_active, true)
    )
  );

DROP POLICY IF EXISTS update_print_jobs_for_company_members ON public.print_jobs;
CREATE POLICY update_print_jobs_for_company_members
  ON public.print_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.print_jobs.company_id
        AND cu.user_id = auth.uid()
        AND COALESCE(cu.is_active, true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_users cu
      WHERE cu.company_id = public.print_jobs.company_id
        AND cu.user_id = auth.uid()
        AND COALESCE(cu.is_active, true)
    )
  );

