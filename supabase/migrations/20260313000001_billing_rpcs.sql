-- =============================================================================
-- Billing RPCs: check_and_increment_usage, decrement_monthly_usage,
--               increment_usage_monthly
--
-- Estas funções são chamadas em app/api/whatsapp/send/route.ts e
-- app/api/chatbot/resolve/route.ts. Sem elas, todo envio de mensagem
-- retorna erro 500.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) check_and_increment_usage
--    Verifica o limite do plano, reserva atomicamente +p_amount se permitido.
--    Retorna jsonb: { allowed, used, limit, overage }
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_increment_usage(
    p_company  uuid,
    p_feature  text,
    p_amount   int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_year_month    text;
    v_limit         int;
    v_used          int;
    v_allow_overage boolean;
BEGIN
    v_year_month := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');

    -- Limite do plano ativo para esta feature
    SELECT COALESCE(fl.limit_per_month, 999999999)
      INTO v_limit
      FROM public.subscriptions s
      JOIN public.feature_limits fl
        ON fl.plan_id    = s.plan_id
       AND fl.feature_key = p_feature
     WHERE s.company_id = p_company
       AND s.status     = 'active'
     LIMIT 1;

    -- Sem plano/limite cadastrado → ilimitado
    IF v_limit IS NULL THEN
        v_limit := 999999999;
    END IF;

    -- Flag overage da subscription
    SELECT COALESCE(s.allow_overage, false)
      INTO v_allow_overage
      FROM public.subscriptions s
     WHERE s.company_id = p_company
       AND s.status     = 'active'
     LIMIT 1;

    IF v_allow_overage IS NULL THEN
        v_allow_overage := false;
    END IF;

    -- Garante linha de uso do mês (upsert seguro)
    INSERT INTO public.usage_monthly (company_id, feature_key, year_month, used)
    VALUES (p_company, p_feature, v_year_month, 0)
    ON CONFLICT (company_id, feature_key, year_month) DO NOTHING;

    -- Lê uso atual
    SELECT used
      INTO v_used
      FROM public.usage_monthly
     WHERE company_id   = p_company
       AND feature_key  = p_feature
       AND year_month   = v_year_month;

    v_used := COALESCE(v_used, 0);

    -- Verifica limite (bloqueia se ultrapassado e sem overage)
    IF v_used >= v_limit AND NOT v_allow_overage THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'used',    v_used,
            'limit',   v_limit,
            'overage', false
        );
    END IF;

    -- Incrementa atomicamente
    UPDATE public.usage_monthly
       SET used = used + p_amount
     WHERE company_id   = p_company
       AND feature_key  = p_feature
       AND year_month   = v_year_month;

    RETURN jsonb_build_object(
        'allowed', true,
        'used',    v_used + p_amount,
        'limit',   v_limit,
        'overage', (v_used >= v_limit AND v_allow_overage)
    );
END;
$$;

ALTER FUNCTION public.check_and_increment_usage(uuid, text, int) OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 2) decrement_monthly_usage
--    Reverte uma reserva anterior (ex.: falha no envio).
--    Nunca deixa "used" ficar negativo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_monthly_usage(
    p_company  uuid,
    p_feature  text,
    p_amount   int DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_year_month text;
BEGIN
    v_year_month := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');

    UPDATE public.usage_monthly
       SET used = GREATEST(0, used - p_amount)
     WHERE company_id   = p_company
       AND feature_key  = p_feature
       AND year_month   = v_year_month;
END;
$$;

ALTER FUNCTION public.decrement_monthly_usage(uuid, text, int) OWNER TO postgres;

-- -----------------------------------------------------------------------------
-- 3) increment_usage_monthly
--    Versão simplificada sem checagem de limite.
--    Usada pelo chatbot para contabilizar mensagens automáticas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_usage_monthly(
    p_company  uuid,
    p_feature  text    DEFAULT 'whatsapp_messages',
    p_used     int     DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_year_month text;
BEGIN
    v_year_month := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');

    INSERT INTO public.usage_monthly (company_id, feature_key, year_month, used)
    VALUES (p_company, p_feature, v_year_month, p_used)
    ON CONFLICT (company_id, feature_key, year_month)
    DO UPDATE SET used = public.usage_monthly.used + EXCLUDED.used;
END;
$$;

ALTER FUNCTION public.increment_usage_monthly(uuid, text, int) OWNER TO postgres;
