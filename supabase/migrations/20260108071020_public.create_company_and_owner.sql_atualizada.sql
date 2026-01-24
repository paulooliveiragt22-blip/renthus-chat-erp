-- create_company_and_owner (corrigida: sempre fornece 'name' quando a coluna existe)
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
  v_whatsapp_phone text;
  v_cep text;
  v_endereco text;
  v_numero text;
  v_bairro text;
  v_cidade text;
  v_uf text;
  v_meta jsonb := '{}'::jsonb;
  v_settings jsonb := '{}'::jsonb;
  v_company_id uuid;
  v_company_row jsonb;
  v_found boolean := false;

  -- flags sobre colunas existentes
  has_cnpj_col boolean := false;
  has_meta_col boolean := false;
  has_razao_col boolean := false;
  has_nomefant_col boolean := false;
  has_name_col boolean := false;
  has_email_col boolean := false;
  has_phone_col boolean := false;
  has_whatsapp_col boolean := false;
  has_slug_col boolean := false;
  has_cep_col boolean := false;
  has_endereco_col boolean := false;
  has_numero_col boolean := false;
  has_bairro_col boolean := false;
  has_cidade_col boolean := false;
  has_uf_col boolean := false;
  has_owner_id_col boolean := false;
  has_created_at_col boolean := false;
  has_updated_at_col boolean := false;
  has_is_active_col boolean := false;
BEGIN
  -- garante colunas mínimas de timestamps/flag se não existirem (idempotente)
  ALTER TABLE IF EXISTS public.companies
    ADD COLUMN IF NOT EXISTS created_at timestamptz;
  ALTER TABLE IF EXISTS public.companies
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;
  ALTER TABLE IF EXISTS public.companies
    ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

  -- ler valores do payload (vários aliases para compatibilidade)
  v_name := trim(COALESCE(payload->>'name', ''));
  v_razao := trim(COALESCE(payload->>'razao_social', payload->>'razao', payload->>'razaoSocial', payload->>'name', v_name));
  v_nomefant := NULLIF(trim(COALESCE(payload->>'nome_fantasia', payload->>'nomeFantasia', '')), '');
  v_cnpj := NULLIF(trim(COALESCE(payload->>'cnpj', (payload->'meta'->>'cnpj')::text, '')), '');
  IF v_cnpj IS NOT NULL THEN
    v_cnpj := regexp_replace(v_cnpj, '\D', '', 'g');
  END IF;
  v_email := NULLIF(trim(COALESCE(payload->>'email', '')), '');
  v_phone := NULLIF(trim(COALESCE(payload->>'phone', '')), '');
  v_whatsapp_phone := NULLIF(trim(COALESCE(payload->>'whatsapp_phone', '')), '');

  -- endereço
  v_cep := NULLIF(trim(COALESCE(payload->>'cep', (payload->'address'->>'cep')::text, '')), '');
  v_endereco := NULLIF(trim(COALESCE(payload->>'endereco', (payload->'address'->>'endereco')::text, '')), '');
  v_numero := NULLIF(trim(COALESCE(payload->>'numero', (payload->'address'->>'numero')::text, '')), '');
  v_bairro := NULLIF(trim(COALESCE(payload->>'bairro', (payload->'address'->>'bairro')::text, '')), '');
  v_cidade := NULLIF(trim(COALESCE(payload->>'cidade', (payload->'address'->>'cidade')::text, '')), '');
  v_uf := NULLIF(trim(COALESCE(payload->>'uf', (payload->'address'->>'uf')::text, '')), '');

  IF payload ? 'meta' THEN
    v_meta := COALESCE(payload->'meta', '{}'::jsonb);
  END IF;
  IF payload ? 'settings' THEN
    v_settings := COALESCE(payload->'settings', '{}'::jsonb);
  END IF;

  -- garante v_name preenchido (não nulo). NOT NULL constraint aceita empty string.
  IF v_name IS NULL OR trim(v_name) = '' THEN
    v_name := COALESCE(NULLIF(v_razao, ''), NULLIF(v_nomefant, ''), '');
  END IF;

  -- coloca razao/nomefant/cnpj dentro de meta para compatibilidade
  IF v_razao IS NOT NULL AND v_razao <> '' THEN
    v_meta := jsonb_set(v_meta, '{razao_social}', to_jsonb(v_razao::text), true);
  END IF;
  IF v_nomefant IS NOT NULL AND v_nomefant <> '' THEN
    v_meta := jsonb_set(v_meta, '{nome_fantasia}', to_jsonb(v_nomefant::text), true);
  END IF;
  IF v_cnpj IS NOT NULL AND v_cnpj <> '' THEN
    v_meta := jsonb_set(v_meta, '{cnpj}', to_jsonb(v_cnpj::text), true);
  END IF;

  -- checa existência de colunas na tabela companies (para não referenciar colunas ausentes)
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='cnpj') INTO has_cnpj_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='meta') INTO has_meta_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='razao_social') INTO has_razao_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='nome_fantasia') INTO has_nomefant_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='name') INTO has_name_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='email') INTO has_email_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='phone') INTO has_phone_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='whatsapp_phone') INTO has_whatsapp_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='slug') INTO has_slug_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='cep') INTO has_cep_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='endereco') INTO has_endereco_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='numero') INTO has_numero_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='bairro') INTO has_bairro_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='cidade') INTO has_cidade_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='uf') INTO has_uf_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='owner_id') INTO has_owner_id_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='created_at') INTO has_created_at_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='updated_at') INTO has_updated_at_col;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='is_active') INTO has_is_active_col;

  -- checa duplicidade de CNPJ de forma dinâmica
  IF v_cnpj IS NOT NULL AND v_cnpj <> '' THEN
    IF has_cnpj_col THEN
      EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.companies WHERE regexp_replace(cnpj, ''\D'', '''', ''g'') = $1)' USING v_cnpj INTO v_found;
    ELSIF has_meta_col THEN
      EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.companies WHERE (meta->>''cnpj'') IS NOT NULL AND regexp_replace(meta->>''cnpj'',''\D'','''',''g'') = $1)' USING v_cnpj INTO v_found;
    ELSE
      v_found := false;
    END IF;

    IF v_found THEN
      RAISE EXCEPTION 'cnpj already registered';
    END IF;
  END IF;

  -- confirma que o creator existe na tabela auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = creator_uuid) THEN
    RAISE EXCEPTION 'creator user not found';
  END IF;

  -- Inserção segura:
  IF has_meta_col THEN
    -- se existe name column, incluí-la no insert para satisfazer NOT NULL
    IF has_name_col AND has_is_active_col AND has_created_at_col AND has_updated_at_col THEN
      EXECUTE 'INSERT INTO public.companies (name, meta, settings, is_active, created_at, updated_at) VALUES ($1, $2, $3, true, now(), now()) RETURNING id' USING v_name, v_meta, v_settings INTO v_company_id;
    ELSIF has_name_col AND has_is_active_col AND has_created_at_col THEN
      EXECUTE 'INSERT INTO public.companies (name, meta, settings, is_active, created_at) VALUES ($1, $2, $3, true, now()) RETURNING id' USING v_name, v_meta, v_settings INTO v_company_id;
    ELSIF has_name_col THEN
      EXECUTE 'INSERT INTO public.companies (name, meta, settings) VALUES ($1, $2, $3) RETURNING id' USING v_name, v_meta, v_settings INTO v_company_id;
    ELSIF has_is_active_col AND has_created_at_col AND has_updated_at_col THEN
      EXECUTE 'INSERT INTO public.companies (meta, settings, is_active, created_at, updated_at) VALUES ($1, $2, true, now(), now()) RETURNING id' USING v_meta, v_settings INTO v_company_id;
    ELSIF has_is_active_col AND has_created_at_col THEN
      EXECUTE 'INSERT INTO public.companies (meta, settings, is_active, created_at) VALUES ($1, $2, true, now()) RETURNING id' USING v_meta, v_settings INTO v_company_id;
    ELSE
      EXECUTE 'INSERT INTO public.companies (meta, settings) VALUES ($1, $2) RETURNING id' USING v_meta, v_settings INTO v_company_id;
    END IF;
  ELSE
    -- meta não existe: priorize inserir name se existir
    IF has_name_col AND has_is_active_col AND has_created_at_col AND has_updated_at_col THEN
      EXECUTE 'INSERT INTO public.companies (name, is_active, created_at, updated_at) VALUES ($1, true, now(), now()) RETURNING id' USING v_name INTO v_company_id;
    ELSIF has_name_col AND has_is_active_col AND has_created_at_col THEN
      EXECUTE 'INSERT INTO public.companies (name, is_active, created_at) VALUES ($1, true, now()) RETURNING id' USING v_name INTO v_company_id;
    ELSIF has_name_col THEN
      EXECUTE 'INSERT INTO public.companies (name) VALUES ($1) RETURNING id' USING v_name INTO v_company_id;
    ELSIF has_is_active_col AND has_created_at_col AND has_updated_at_col THEN
      EXECUTE 'INSERT INTO public.companies (is_active, created_at, updated_at) VALUES (true, now(), now()) RETURNING id' INTO v_company_id;
    ELSE
      EXECUTE 'INSERT INTO public.companies (settings) VALUES ($1) RETURNING id' USING v_settings INTO v_company_id;
    END IF;
  END IF;

  -- Atualiza colunas explícitas se existirem (idempotente)
  IF has_razao_col THEN
    EXECUTE 'UPDATE public.companies SET razao_social = $1 WHERE id = $2' USING v_razao, v_company_id;
  END IF;
  IF has_nomefant_col THEN
    IF v_nomefant IS NOT NULL THEN
      EXECUTE 'UPDATE public.companies SET nome_fantasia = $1 WHERE id = $2' USING v_nomefant, v_company_id;
    END IF;
  END IF;
  IF has_cnpj_col AND v_cnpj IS NOT NULL THEN
    EXECUTE 'UPDATE public.companies SET cnpj = $1 WHERE id = $2' USING v_cnpj, v_company_id;
  END IF;
  IF has_email_col THEN
    EXECUTE 'UPDATE public.companies SET email = $1 WHERE id = $2' USING v_email, v_company_id;
  END IF;
  IF has_phone_col THEN
    EXECUTE 'UPDATE public.companies SET phone = $1 WHERE id = $2' USING v_phone, v_company_id;
  END IF;
  IF has_whatsapp_col THEN
    EXECUTE 'UPDATE public.companies SET whatsapp_phone = $1 WHERE id = $2' USING v_whatsapp_phone, v_company_id;
  END IF;
  IF has_slug_col THEN
    IF v_nomefant IS NOT NULL AND v_nomefant <> '' THEN
      EXECUTE 'UPDATE public.companies SET slug = $1 WHERE id = $2' USING regexp_replace(lower(v_nomefant), '[^a-z0-9]+','-','g'), v_company_id;
    ELSE
      EXECUTE 'UPDATE public.companies SET slug = $1 WHERE id = $2' USING regexp_replace(lower(v_razao), '[^a-z0-9]+','-','g'), v_company_id;
    END IF;
  END IF;
  IF has_cep_col THEN EXECUTE 'UPDATE public.companies SET cep = $1 WHERE id = $2' USING v_cep, v_company_id; END IF;
  IF has_endereco_col THEN EXECUTE 'UPDATE public.companies SET endereco = $1 WHERE id = $2' USING v_endereco, v_company_id; END IF;
  IF has_numero_col THEN EXECUTE 'UPDATE public.companies SET numero = $1 WHERE id = $2' USING v_numero, v_company_id; END IF;
  IF has_bairro_col THEN EXECUTE 'UPDATE public.companies SET bairro = $1 WHERE id = $2' USING v_bairro, v_company_id; END IF;
  IF has_cidade_col THEN EXECUTE 'UPDATE public.companies SET cidade = $1 WHERE id = $2' USING v_cidade, v_company_id; END IF;
  IF has_uf_col THEN EXECUTE 'UPDATE public.companies SET uf = $1 WHERE id = $2' USING v_uf, v_company_id; END IF;
  IF has_owner_id_col THEN EXECUTE 'UPDATE public.companies SET owner_id = $1 WHERE id = $2' USING creator_uuid, v_company_id; END IF;

  -- vincula usuário como owner (company_users)
  INSERT INTO public.company_users (company_id, user_id, role, is_active, created_at)
  VALUES (v_company_id, creator_uuid, 'owner', true, now());

  -- Recupera a linha criada em formato JSON
  SELECT to_jsonb(c) INTO v_company_row
  FROM public.companies c
  WHERE c.id = v_company_id;

  -- retorna o resultado
  company_id := v_company_id;
  company := v_company_row;
  RETURN NEXT;
  RETURN;
EXCEPTION
  WHEN others THEN
    RAISE;
END;
$$;
