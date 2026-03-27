-- Migration: favoritos de clientes (produtos mais pedidos)

CREATE TABLE IF NOT EXISTS public.customer_favorites (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_phone        TEXT        NOT NULL,
  produto_embalagem_id  UUID        NOT NULL REFERENCES public.produto_embalagens(id) ON DELETE CASCADE,
  order_count           INTEGER     NOT NULL DEFAULT 0,
  last_ordered_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, customer_phone, produto_embalagem_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_favorites_lookup
  ON public.customer_favorites(company_id, customer_phone, order_count DESC);

-- RLS: service_role acessa diretamente (webhook não tem auth)
ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access to customer favorites"
  ON public.customer_favorites FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "company members can read favorites"
  ON public.customer_favorites FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.company_users
      WHERE user_id = auth.uid()
    )
  );

-- Trigger: atualiza favoritos quando pedido é confirmado
CREATE OR REPLACE FUNCTION public.update_customer_favorites()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Dispara apenas quando confirmation_status muda para 'confirmed'
  IF NEW.confirmation_status = 'confirmed'
    AND (OLD.confirmation_status IS DISTINCT FROM 'confirmed')
  THEN
    INSERT INTO public.customer_favorites (
      company_id, customer_phone, produto_embalagem_id, order_count, last_ordered_at
    )
    SELECT
      NEW.company_id,
      t.phone_e164,           -- phone da thread (via session)
      oi.produto_embalagem_id,
      1,
      NEW.created_at
    FROM public.order_items oi
    -- busca phone pelo customer_id → customers → whatsapp_threads não é direto
    -- usa customer_phone via customers.phone se disponível
    LEFT JOIN public.customers c ON c.id = NEW.customer_id
    -- usamos phone_e164 da thread via chatbot_sessions quando customer não tem phone
    CROSS JOIN LATERAL (
      SELECT COALESCE(c.phone, cs.context->>'customer_phone', '') AS phone_e164
      FROM public.chatbot_sessions cs
      WHERE cs.company_id = NEW.company_id
        AND cs.customer_id = NEW.customer_id
      ORDER BY cs.updated_at DESC
      LIMIT 1
    ) t
    WHERE oi.order_id = NEW.id
      AND oi.produto_embalagem_id IS NOT NULL
      AND t.phone_e164 <> ''
    ON CONFLICT (company_id, customer_phone, produto_embalagem_id)
    DO UPDATE SET
      order_count     = customer_favorites.order_count + 1,
      last_ordered_at = NEW.created_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_customer_favorites ON public.orders;
CREATE TRIGGER trg_update_customer_favorites
  AFTER INSERT OR UPDATE OF confirmation_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_customer_favorites();
