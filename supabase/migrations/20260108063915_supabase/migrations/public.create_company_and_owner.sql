-- create_company_and_owner_explicit.sql
-- RPC que cria company e vincula owner (inserindo nos campos explícitos)

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
  v_razao text;
  v_nomefant text;
  v_cnpj text;
  v_email text;
  v_phone text;
  v_whatsapp text;
  v_cep text;
  v_endereco text;
  v_numero text;
  v_bairro text;
  v_cidade text;
  v_uf text;
  v_plan_id uuid;
  v_meta jsonb := '{}'::jsonb;
  v_settings jsonb := '{}'::jsonb;
  v_company_id uuid;
  v_company_jsonb jsonb;
BEGIN
  -- Extrai campos do payload (aceita company: { ... })
  v_razao := trim(COALESCE(payload->>'razao_social', payload->>'razao', payload->>'razaoSocial', payload->>'name', ''));
  IF v_razao IS NULL OR v_razao = '' THEN
    RAISE EXCEPTION 'razao_social (company name) is required';
  END IF;

  v_nomefant := NULLIF(trim(COALESCE(payload->>'nome_fantasia', payload->>'nomeFantasia', '')), '');
  v_cnpj := NULLIF(trim(COALESCE(payload->>'cnpj', (payload->'meta'->>'cnpj')::text, '')), '');
  IF v_cnpj IS NOT NULL THEN
    v_cnpj := regexp_replace(v_cnpj, '\D', '', 'g'); -- só dígitos
  END IF;

  v_email := NULLIF(trim(COALESCE(payload->>'email', '')), '');
  v_phone := NULLIF(trim(COALESCE(payload->>'phone', '')), '');
  v_whatsapp := NULLIF(trim(COALESCE(payload->>'whatsapp_phone', '')), '');

  -- endereço
  v_cep := NULLIF(trim(COALESCE(payload->>'cep', (payload->'address'->>'cep')::text, '')), '');
  v_endereco := NULLIF(trim(COALESCE(payload->>'endereco', (payload->'address'->>'endereco')::text, '')), '');
  v_numero := NULLIF(trim(COALESCE(payload->>'numero', (payload->'address'->>'numero')::text, '')), '');
  v_bairro := NULLIF(trim(COALESCE(payload->>'bairro', (payload->'address'->>'bairro')::text, '')), '');
  v_cidade := NULLIF(trim(COALESCE(payload->>'cidade', (payload->'address'->>'cidade')::text, '')), '');
  v_uf := NULLIF(trim(COALESCE(payload->>'uf', (payload->'address'->>'uf')::text, '')), '');

  -- plan e meta/settings opcionais
  IF payload ? 'plan_id' THEN
    v_plan_id := (payload->>'plan_id')::uuid;
  END IF;
  IF payload ? 'meta' THEN
    v_meta := COALESCE(payload->'meta', '{}'::jsonb);
  END IF;
  IF payload ? 'settings' THEN
    v_settings := COALESCE(payload->'settings', '{}'::jsonb);
  END IF;

  -- checagem de duplicidade por CNPJ se informado
  IF v_cnpj IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.cnpj IS NOT NULL
        AND regexp_replace(c.cnpj,'\D','','g') = v_cnpj
    ) THEN
      RAISE EXCEPTION 'CNPJ already registered';
    END IF;
  END IF;

  -- valida creator existe
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = creator_uuid) THEN
    RAISE EXCEPTION 'creator user not found';
  END IF;

  -- Insere company
  INSERT INTO public.companies (
    cnpj, razao_social, nome_fantasia, email, phone,
    cep, endereco, numero, bairro, cidade, uf,
    owner_id, plan_id, is_active, meta, settings, created_at, updated_at
  )
  VALUES (
    v_cnpj, v_razao, v_nomefant, v_email, v_phone,
    v_cep, v_endereco, v_numero, v_bairro, v_cidade, v_uf,
    creator_uuid, v_plan_id, true, v_meta, v_settings, now(), now()
  )
  RETURNING id INTO v_company_id;

  -- recuperar company em jsonb
  SELECT to_jsonb(c) INTO v_company_jsonb FROM public.companies c WHERE c.id = v_company_id;

  -- vincula company_users como owner
  INSERT INTO public.company_users (company_id, user_id, role, is_active, created_at)
  VALUES (v_company_id, creator_uuid, 'owner', true, now());

  -- retorna a linha criada
  company_id := v_company_id;
  company := v_company_jsonb;
  RETURN NEXT;
  RETURN;
EXCEPTION
  WHEN others THEN
    RAISE;
END;
$$;
