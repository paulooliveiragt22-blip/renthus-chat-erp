-- cria helpers (SECURITY DEFINER) para membership / admin checks
CREATE OR REPLACE FUNCTION public.is_company_member(_user uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = _company
      AND cu.user_id = _user
      AND COALESCE(cu.is_active, true)
  );
$$;
ALTER FUNCTION public.is_company_member(uuid, uuid) OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.is_company_admin(_user uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = _company
      AND cu.user_id = _user
      AND cu.role = ANY (ARRAY['owner'::text, 'admin'::text])
      AND COALESCE(cu.is_active, true)
  );
$$;
ALTER FUNCTION public.is_company_admin(uuid, uuid) OWNER TO postgres;


DROP POLICY IF EXISTS company_users_select_self ON public.company_users;
DROP POLICY IF EXISTS company_users_select ON public.company_users;

CREATE POLICY company_users_select_self
  ON public.company_users FOR SELECT
  USING (
    (current_setting('jwt.claims.user_id', true) IS NOT NULL
     AND user_id = current_setting('jwt.claims.user_id', true)::uuid)
    OR auth.role() = 'service_role'
  );

CREATE POLICY company_users_select
  ON public.company_users FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR (
      current_setting('jwt.claims.user_id', true) IS NOT NULL
      AND (
        user_id = current_setting('jwt.claims.user_id', true)::uuid
        OR public.is_company_admin(current_setting('jwt.claims.user_id', true)::uuid, company_id)
      )
    )
  );


-- printers
DROP POLICY IF EXISTS insert_printers_for_company_members ON public.printers;
DROP POLICY IF EXISTS update_printers_for_company_members ON public.printers;

CREATE POLICY insert_printers_for_company_members
  ON public.printers FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND public.is_company_member(auth.uid(), company_id)
    )
  );

CREATE POLICY update_printers_for_company_members
  ON public.printers FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND public.is_company_member(auth.uid(), company_id)
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() IS NOT NULL
      AND public.is_company_member(auth.uid(), company_id)
    )
  );

-- print_jobs
DROP POLICY IF EXISTS insert_print_jobs_for_company_members ON public.print_jobs;
DROP POLICY IF EXISTS update_print_jobs_for_company_members ON public.print_jobs;
DROP POLICY IF EXISTS select_print_jobs_for_agents ON public.print_jobs;

CREATE POLICY insert_print_jobs_for_company_members
  ON public.print_jobs FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR current_user = 'postgres'   -- fallback: owner internal calls
    OR (
      auth.uid() IS NOT NULL
      AND public.is_company_member(auth.uid(), company_id)
    )
  );

CREATE POLICY update_print_jobs_for_company_members
  ON public.print_jobs FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR current_user = 'postgres'
    OR (
      auth.uid() IS NOT NULL
      AND public.is_company_member(auth.uid(), company_id)
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR current_user = 'postgres'
    OR (
      auth.uid() IS NOT NULL
      AND public.is_company_member(auth.uid(), company_id)
    )
  );

-- permitir SELECT para agentes autenticados (se o agent usar auth.uid)
CREATE POLICY select_print_jobs_for_agents
  ON public.print_jobs FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR current_user = 'postgres'
    OR (
      auth.uid() IS NOT NULL
      AND (
        public.is_company_member(auth.uid(), company_id)
        -- ou outra regra: auth.uid() ser o owner do printer, se você criou users para agents
      )
    )
  );

CREATE OR REPLACE FUNCTION public.enqueue_print_job_for_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_printer_id uuid;
  v_printer_format text;
  v_payload jsonb;
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status,'') <> 'new' THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.print_jobs WHERE source='order' AND source_id = NEW.id AND status IN ('pending','processing')) THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.format
  INTO v_printer_id, v_printer_format
  FROM public.company_printers cp
  JOIN public.printers p ON p.id = cp.printer_id
  WHERE cp.company_id = NEW.company_id
    AND COALESCE(cp.is_default,false) = true
    AND COALESCE(p.is_active, true) = true
  LIMIT 1;

  IF v_printer_id IS NULL THEN
    SELECT p.id, p.format INTO v_printer_id, v_printer_format
    FROM public.printers p
    WHERE p.company_id = NEW.company_id
      AND COALESCE(p.auto_print,false) = true
      AND COALESCE(p.is_active, true) = true
    ORDER BY p.created_at LIMIT 1;
  END IF;

  IF v_printer_id IS NULL THEN RETURN NEW; END IF;

  v_payload := jsonb_build_object('type', COALESCE(v_printer_format,'receipt'), 'orderId', NEW.id::text);

  INSERT INTO public.print_jobs (company_id, source, source_id, printer_id, payload, status, priority, max_attempts, created_at)
  VALUES (NEW.company_id, 'order', NEW.id, v_printer_id, v_payload, 'pending', 100, 5, now());

  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enqueue_print_job_for_order() OWNER TO postgres;
