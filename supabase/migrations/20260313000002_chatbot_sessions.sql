-- =============================================================================
-- chatbot_sessions: Estado da conversa do bot por thread
-- pg_trgm: Busca fuzzy de produtos (ex: "heinekin" → "Heineken")
-- fix: constraint única em whatsapp_threads deve ser (company_id, phone_e164)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) pg_trgm para busca por similaridade
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- 2) Corrigir constraint única em whatsapp_threads
--    O índice antigo (só phone_e164) impede multi-tenant.
--    O índice composto correto já deve existir, mas garantimos aqui.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    -- Remove constraint antiga (apenas phone_e164) se ainda existir
    -- Precisa dropar a CONSTRAINT antes do índice (PostgreSQL exige)
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname   = 'whatsapp_threads_phone_e164_key'
           AND conrelid  = 'public.whatsapp_threads'::regclass
    ) THEN
        EXECUTE 'ALTER TABLE public.whatsapp_threads DROP CONSTRAINT whatsapp_threads_phone_e164_key';
    END IF;

    -- Remove o índice órfão se ainda existir após dropar a constraint
    IF EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE tablename  = 'whatsapp_threads'
           AND indexname  = 'whatsapp_threads_phone_e164_key'
    ) THEN
        EXECUTE 'DROP INDEX IF EXISTS whatsapp_threads_phone_e164_key';
    END IF;
END;
$$;

-- Garante o índice composto correto (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_threads_company_phone_unique
    ON public.whatsapp_threads (company_id, phone_e164);

-- -----------------------------------------------------------------------------
-- 3) Tabela chatbot_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chatbot_sessions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id   uuid        NOT NULL REFERENCES public.whatsapp_threads(id) ON DELETE CASCADE,
    company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Passo atual no fluxo do bot
    -- Valores: welcome | main_menu | catalog_categories | catalog_products
    --          cart | checkout_address | checkout_payment | checkout_confirm | done | handover
    step        text        NOT NULL DEFAULT 'welcome',

    -- Carrinho: [{ variantId, productId, name, price, qty }]
    cart        jsonb       NOT NULL DEFAULT '[]'::jsonb,

    -- ID do cliente encontrado/criado (preenchido no checkout)
    customer_id uuid        REFERENCES public.customers(id),

    -- Contexto livre para guardar estado temporário
    -- Ex: { selected_category_id, pending_qty, address_draft, payment_method }
    context     jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- Sessão expira após 2h de inatividade
    expires_at  timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Uma sessão ativa por thread
CREATE UNIQUE INDEX IF NOT EXISTS chatbot_sessions_thread_idx
    ON public.chatbot_sessions (thread_id);

-- Índice para limpeza de sessões expiradas
CREATE INDEX IF NOT EXISTS chatbot_sessions_expires_idx
    ON public.chatbot_sessions (expires_at);

-- RLS
ALTER TABLE public.chatbot_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chatbot_sessions_service_role ON public.chatbot_sessions;
CREATE POLICY chatbot_sessions_service_role
    ON public.chatbot_sessions
    USING (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- 4) Função para limpar sessões expiradas (pode ser chamada por cron)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_chatbot_sessions()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count int;
BEGIN
    DELETE FROM public.chatbot_sessions
     WHERE expires_at < now()
       AND step NOT IN ('done');

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

ALTER FUNCTION public.cleanup_expired_chatbot_sessions() OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 5) Índice trgm em products.name para busca fuzzy
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
    ON public.products USING gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 6) Coluna handover_at em whatsapp_threads (marca quando bot passou para humano)
-- -----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_threads
    ADD COLUMN IF NOT EXISTS handover_at  timestamptz,
    ADD COLUMN IF NOT EXISTS bot_active   boolean NOT NULL DEFAULT true;
