-- Migration: tabela de tickets de suporte (handover humano)

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_phone TEXT      NOT NULL,
  customer_name  TEXT,
  status       TEXT        NOT NULL DEFAULT 'open',
  -- 'open' | 'in_progress' | 'resolved' | 'closed'
  priority     TEXT        NOT NULL DEFAULT 'normal',
  -- 'low' | 'normal' | 'high' | 'urgent'
  message      TEXT,
  assigned_to  UUID        REFERENCES auth.users(id),
  resolved_by  UUID        REFERENCES auth.users(id),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_company_status
  ON public.support_tickets(company_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_tickets_assigned
  ON public.support_tickets(assigned_to, status)
  WHERE assigned_to IS NOT NULL;

-- updated_at automático
CREATE OR REPLACE FUNCTION public.set_updated_at_support_tickets()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_support_tickets();

-- RLS: membros da empresa veem/editam seus próprios tickets
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members can manage tickets"
  ON public.support_tickets
  FOR ALL
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.company_users
      WHERE user_id = auth.uid()
    )
  );
