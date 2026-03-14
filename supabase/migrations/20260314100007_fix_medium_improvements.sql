-- ============================================================
-- MIGRATION: Melhorias médias — constraints e normalizações
-- ============================================================

-- 1. Unique constraint em company_integrations(company_id, provider)
--    Evita duplicatas de provider por empresa
CREATE UNIQUE INDEX IF NOT EXISTS company_integrations_company_provider_uq
  ON public.company_integrations(company_id, provider);

-- 2. Adicionar coluna phone_e164 normalizada em customers
--    (sem remover phone existente para não quebrar app)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_e164 text;

-- Normalizar telefones existentes para formato E.164
UPDATE public.customers
SET phone_e164 = CASE
  -- Já tem + prefixo → manter
  WHEN phone ~ '^\+' THEN phone
  -- 11 dígitos numéricos → +55 + número com DDD
  WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11
    THEN '+55' || regexp_replace(phone, '\D', '', 'g')
  -- 10 dígitos → +55 + número (DDD + 8 dígitos, sem 9 inicial)
  WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10
    THEN '+55' || regexp_replace(phone, '\D', '', 'g')
  -- Fallback: deixar como está
  ELSE phone
END
WHERE phone IS NOT NULL AND phone_e164 IS NULL;

-- Unique index para deduplicação
CREATE UNIQUE INDEX IF NOT EXISTS customers_company_phone_e164_uq
  ON public.customers(company_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

-- 3. Trigger para auto-normalizar phone_e164 em novos customers
CREATE OR REPLACE FUNCTION public.customers_normalize_phone()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone_e164 IS NULL THEN
    NEW.phone_e164 := CASE
      WHEN NEW.phone ~ '^\+' THEN NEW.phone
      WHEN length(regexp_replace(NEW.phone, '\D', '', 'g')) = 11
        THEN '+55' || regexp_replace(NEW.phone, '\D', '', 'g')
      WHEN length(regexp_replace(NEW.phone, '\D', '', 'g')) = 10
        THEN '+55' || regexp_replace(NEW.phone, '\D', '', 'g')
      ELSE NEW.phone
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_normalize_phone ON public.customers;
CREATE TRIGGER trg_customers_normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.customers_normalize_phone();

-- 4. Adicionar index em customers.phone_e164 para lookups do bot
CREATE INDEX IF NOT EXISTS idx_customers_phone_e164
  ON public.customers(phone_e164);

COMMENT ON COLUMN public.customers.phone IS 'Telefone no formato recebido (legado). Use phone_e164 para lookups.';
COMMENT ON COLUMN public.customers.phone_e164 IS 'Telefone normalizado E.164 (+5511999887766). Fonte de verdade para buscas.';
