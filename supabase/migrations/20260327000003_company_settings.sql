-- Migration: configurações por empresa (toggles Flow-First)

CREATE TABLE IF NOT EXISTS public.company_settings (
  company_id            UUID        PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  require_order_approval BOOLEAN    NOT NULL DEFAULT false,
  -- true  = pedidos vão para fila (atendente confirma antes de imprimir)
  -- false = pedidos confirmam automaticamente (recomendado)
  auto_print_orders     BOOLEAN     NOT NULL DEFAULT true,
  -- true  = Agent imprime assim que confirmation_status='confirmed'
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.company_settings IS
  'Configurações operacionais por empresa para o sistema Flow-First';

-- Garante que toda empresa criada já tenha settings com defaults
CREATE OR REPLACE FUNCTION public.create_default_company_settings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.company_settings (company_id)
  VALUES (NEW.id)
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_company_settings ON public.companies;
CREATE TRIGGER trg_create_company_settings
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.create_default_company_settings();

-- Retroativo: cria settings para empresas já existentes
INSERT INTO public.company_settings (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;

-- RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members can read settings"
  ON public.company_settings
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.company_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "company members can update settings"
  ON public.company_settings
  FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.company_users
      WHERE user_id = auth.uid()
    )
  );
