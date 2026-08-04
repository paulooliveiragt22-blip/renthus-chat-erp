-- F4.3: domínio próprio / subdomínio do cardápio web.

ALTER TABLE public.company_menu_profile
    ADD COLUMN IF NOT EXISTS custom_domain text NULL,
    ADD COLUMN IF NOT EXISTS custom_domain_verified boolean NOT NULL DEFAULT false;

ALTER TABLE public.company_menu_profile
    DROP CONSTRAINT IF EXISTS company_menu_profile_custom_domain_format_chk;

ALTER TABLE public.company_menu_profile
    ADD CONSTRAINT company_menu_profile_custom_domain_format_chk
        CHECK (
            custom_domain IS NULL
            OR custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
        );

CREATE UNIQUE INDEX IF NOT EXISTS company_menu_profile_custom_domain_uidx
    ON public.company_menu_profile (custom_domain)
    WHERE custom_domain IS NOT NULL;

COMMENT ON COLUMN public.company_menu_profile.custom_domain IS
    'Host customizado do cardápio (ex.: cardapio.loja.com.br). Ops adiciona no Vercel.';
COMMENT ON COLUMN public.company_menu_profile.custom_domain_verified IS
    'true após CNAME/DNS apontar e domínio anexado no projeto Vercel.';

CREATE OR REPLACE FUNCTION public.rpc_resolve_menu_slug_by_host(p_host text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_host text := lower(trim(COALESCE(p_host, '')));
    v_slug text;
BEGIN
    -- remove porta
    v_host := regexp_replace(v_host, ':\d+$', '');
    IF v_host = '' OR position('/' in v_host) > 0 THEN
        RETURN NULL;
    END IF;
    IF left(v_host, 4) = 'www.' THEN
        v_host := substr(v_host, 5);
    END IF;

    SELECT p.slug INTO v_slug
    FROM public.company_menu_profile p
    WHERE p.custom_domain = v_host
      AND p.custom_domain_verified = true
      AND p.is_active = true
    LIMIT 1;

    RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_resolve_menu_slug_by_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_menu_slug_by_host(text) TO service_role;

COMMENT ON FUNCTION public.rpc_resolve_menu_slug_by_host(text) IS
    'F4.3: resolve host customizado verificado → slug do cardápio (service_role).';
