-- create_company_and_owner.sql
-- Cria a função RPC que cria uma company e vincula um owner, tudo em uma transação atômica.
-- Requisitos:
-- - Tabelas: public.companies, public.company_users (conforme migrations que você já tem/configurou).
-- - A função faz validações mínimas: campo 'name' obrigatório, checagem de CNPJ duplicado se presente, validação de usuário criador em auth.users.

CREATE OR REPLACE FUNCTION public.create_company_and_owner(
  creator_uuid uuid,
  payload jsonb
)
RETURNS TABLE (company_id uuid, company jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_name text;
  v_slug text;
  v_email text;
  v_phone text;
  v_whatsapp_phone text;
  v_meta jsonb := '{}'::jsonb;
  v_settings jsonb := '{}'::jsonb;
  v_cnpj text;
  v_company_id uuid;
  v_company_row RECORD;
BEGIN
  -- validações básicas
  v_name := trim(COALESCE(payload->>'name', ''));
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'company name is required';
  END IF;

  v_slug := NULLIF(trim(COALESCE(payload->>'slug', '')), '');
  v_email := NULLIF(trim(COALESCE(payload->>'email', '')), '');
  v_phone := NULLIF(trim(COALESCE(payload->>'phone', '')), '');
  v_whatsapp_phone := NULLIF(trim(COALESCE(payload->>'whatsapp_phone', '')), '');

  IF payload ? 'meta' THEN
    v_meta := COALESCE(payload->'meta', '{}'::jsonb);
  END IF;

  IF payload ? 'settings' THEN
    v_settings := COALESCE(payload->'settings', '{}'::jsonb);
  END IF;

  -- normaliza / captura CNPJ se enviado (tanto como payload.cnpj quanto payload.meta.cnpj)
  IF payload ? 'cnpj' THEN
    v_cnpj := regexp_replace(payload->>'cnpj', '\D', '', 'g');
    v_meta := jsonb_set(v_meta, '{cnpj}', to_jsonb(v_cnpj::text), true);
  ELSIF v_meta ? 'cnpj' THEN
    v_cnpj := regexp_replace(v_meta->>'cnpj', '\D', '', 'g');
    v_meta := jsonb_set(v_meta, '{cnpj}', to_jsonb(v_cnpj::text), true);
  END IF;

  -- checa duplicidade de CNPJ (se informado)
  IF v_cnpj IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.companies c
      WHERE (c.meta->>'cnpj') IS NOT NULL
        AND regexp_replace(c.meta->>'cnpj','\D','','g') = v_cnpj
    ) THEN
      RAISE EXCEPTION 'cnpj already registered';
    END IF;
  END IF;

  -- confirma que o creator existe na tabela auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = creator_uuid) THEN
    RAISE EXCEPTION 'creator user not found';
  END IF;

  -- Insere company e company_user dentro de transação (função é atomic por padrão)
  INSERT INTO public.companies (name, slug, email, phone, whatsapp_phone, meta, settings, is_active, created_at, updated_at)
  VALUES (v_name, v_slug, v_email, v_phone, v_whatsapp_phone, v_meta, v_settings, true, now(), now())
  RETURNING id, to_jsonb(public.companies.*) INTO v_company_id, v_company_row;

  -- vincula usuário como owner
  INSERT INTO public.company_users (company_id, user_id, role, is_active, created_at)
  VALUES (v_company_id, creator_uuid, 'owner', true, now());

  -- retorna resultado
  company_id := v_company_id;
  company := v_company_row::jsonb;
  RETURN NEXT;
  RETURN;
EXCEPTION
  WHEN others THEN
    -- Transforma erro em mensagem clara (sai para caller)
    RAISE;
END;
$$;

-- Nota importante:
-- SECURITY DEFINER permite que a função rode com privilégios do dono da função (certifique-se de que o proprietário
-- do objeto seja um role de controle e que a função faça validações internas).
-- Não exponha esta RPC diretamente ao browser sem validações adicionais — a intenção é que o backend chame a RPC.
