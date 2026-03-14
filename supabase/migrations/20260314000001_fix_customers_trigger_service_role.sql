-- Fix: permite que o service_role (chatbot, cron, backend) insira em customers
-- O trigger original verifica auth.uid() incondicionalmente, o que falha para
-- service_role (auth.uid() = NULL). Esta migration substitui o trigger por uma
-- versão que faz bypass quando o papel é 'service_role'.

-- Passo 1: remove todos os triggers existentes na tabela customers
DO $$
DECLARE
    trig_rec RECORD;
BEGIN
    FOR trig_rec IN
        SELECT t.tgname
        FROM pg_trigger t
        WHERE t.tgrelid = 'public.customers'::regclass
          AND NOT t.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.customers', trig_rec.tgname);
        RAISE NOTICE 'Trigger removido: %', trig_rec.tgname;
    END LOOP;
END $$;

-- Passo 2: nova função do trigger com suporte a service_role
CREATE OR REPLACE FUNCTION public.customers_set_company_id()
RETURNS TRIGGER AS $$
DECLARE
    v_company_id uuid;
BEGIN
    -- Service role bypass: backend/chatbot passa company_id explicitamente
    IF auth.role() = 'service_role' THEN
        IF NEW.company_id IS NULL THEN
            RAISE EXCEPTION 'company_id obrigatório para inserts via service_role em customers';
        END IF;
        RETURN NEW;
    END IF;

    -- Usuário autenticado: auto-preenche company_id se não enviado
    IF NEW.company_id IS NULL THEN
        SELECT cu.company_id INTO v_company_id
        FROM public.company_users cu
        WHERE cu.user_id = auth.uid()
          AND cu.is_active = true
        ORDER BY cu.created_at
        LIMIT 1;

        IF v_company_id IS NULL THEN
            RAISE EXCEPTION 'No active company for user %', auth.uid();
        END IF;

        NEW.company_id := v_company_id;
    ELSE
        -- Valida que o usuário pertence à company informada
        IF NOT EXISTS (
            SELECT 1 FROM public.company_users cu
            WHERE cu.user_id   = auth.uid()
              AND cu.company_id = NEW.company_id
              AND cu.is_active  = true
        ) THEN
            RAISE EXCEPTION 'No active company for user %', auth.uid();
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Passo 3: recria o trigger
CREATE TRIGGER trg_customers_set_company_id
    BEFORE INSERT ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.customers_set_company_id();
